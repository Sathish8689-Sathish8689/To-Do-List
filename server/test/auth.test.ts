import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, createUser, login, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});

describe('authentication (FR-019, NFR-002, AC-012)', () => {
  it('rejects unauthenticated access with a consistent error envelope', async () => {
    const res = await request(env.app).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('rejects wrong credentials without revealing which field was wrong', async () => {
    const a = await request(env.app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'nope-nope-nope' });
    const b = await request(env.app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('sets an HttpOnly SameSite=Strict session cookie and never returns the hash', async () => {
    const res = await request(env.app).post('/api/auth/login').send({ email: 'OWNER@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('rate limits repeated failed logins', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(env.app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(env.app).post('/api/auth/login').send({ email: 'owner@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
  });

  it('rate limits repeated failures from one IP across different email addresses', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(env.app).post('/api/auth/login').send({ email: `unknown-${i}@example.com`, password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(env.app)
      .post('/api/auth/login')
      .send({ email: 'another-unknown@example.com', password: 'wrong-password' });
    expect(blocked.status).toBe(429);
  });

  it('rate limits repeated failures for one account across different IP addresses', async () => {
    env = await setup('2026-01-15T12:00:00.000Z', { trustProxy: true });
    for (let i = 1; i <= 5; i++) {
      const r = await request(env.app)
        .post('/api/auth/login')
        .set('x-forwarded-for', `192.0.2.${i}`)
        .send({ email: 'owner@example.com', password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(env.app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '192.0.2.10')
      .send({ email: 'owner@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
  });

  it('requires a valid CSRF token on state-changing requests', async () => {
    const agent = request.agent(env.app);
    const l = await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: PASSWORD });
    const noToken = await agent.post('/api/tasks').send({ title: 'x' });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    const bad = await agent.post('/api/tasks').set('x-csrf-token', 'wrong').send({ title: 'x' });
    expect(bad.status).toBe(403);
    const ok = await agent.post('/api/tasks').set('x-csrf-token', l.body.csrfToken).send({ title: 'x' });
    expect(ok.status).toBe(201);
  });

  it('logs out and invalidates the session', async () => {
    const c = await login(env.app);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('expires sessions after the configured TTL', async () => {
    const c = await login(env.app);
    env.clock.now = new Date(env.clock.now.getTime() + 25 * 3_600_000);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('returns a JSON error for malformed JSON and unknown endpoints', async () => {
    const c = await login(env.app);
    const bad = await request(env.app).post('/api/auth/login').set('content-type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    expect((await c.get('/api/nope')).status).toBe(404);
  });
});

describe('profile and preferences (FR-016, FR-017, AC-010)', () => {
  it('defaults appearance to system and restores the saved account choice on profile/session reads (KAN-3)', async () => {
    const c = await login(env.app);
    expect((await c.get('/api/profile')).body.theme).toBe('system');

    const saved = await c.patch('/api/profile', { theme: 'dark' });
    expect(saved.status).toBe(200);
    expect(saved.body.theme).toBe('dark');
    expect((await c.get('/api/profile')).body.theme).toBe('dark');

    const nextSession = await login(env.app);
    expect((await nextSession.get('/api/auth/me')).body.user.theme).toBe('dark');
  });

  it('keeps the existing profile appearance write behind authentication, CSRF, and enum validation (KAN-3)', async () => {
    const unauthenticated = await request(env.app).patch('/api/profile').send({ theme: 'dark' });
    expect(unauthenticated.status).toBe(401);

    const agent = request.agent(env.app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: PASSWORD });
    const missingCsrf = await agent.patch('/api/profile').send({ theme: 'dark' });
    expect(missingCsrf.status).toBe(403);

    const c = await login(env.app);
    const invalidTheme = await c.patch('/api/profile', { theme: 'sepia' });
    expect(invalidTheme.status).toBe(400);
    expect(invalidTheme.body.error.code).toBe('VALIDATION_ERROR');
    expect((await c.get('/api/profile')).body.theme).toBe('system');
  });

  it('updates profile details and preferences', async () => {
    const c = await login(env.app);
    const res = await c.patch('/api/profile', {
      name: 'New Name',
      email: 'new@example.com',
      theme: 'dark',
      timeZone: 'Asia/Kolkata',
      defaultView: 'calendar',
      notifications: { email: true },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'New Name',
      email: 'new@example.com',
      theme: 'dark',
      timeZone: 'Asia/Kolkata',
      defaultView: 'calendar',
      notifications: { inApp: true, email: true, push: false },
    });
    expect((await c.get('/api/profile')).body.theme).toBe('dark');
  });

  it('validates input', async () => {
    const c = await login(env.app);
    const res = await c.patch('/api/profile', { email: 'not-an-email', timeZone: 'Mars/Base' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'timeZone']);
  });

  it('rejects an email that belongs to another account', async () => {
    await createUser(env.db, 'other@example.com');
    const c = await login(env.app);
    const res = await c.patch('/api/profile', { email: 'other@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('changes the password, requiring the current one, and signs out other sessions', async () => {
    const first = await login(env.app);
    const second = await login(env.app);
    const wrong = await second.post('/api/profile/password', { currentPassword: 'bad-password', newPassword: 'another-long-pass' });
    expect(wrong.status).toBe(400);
    const short = await second.post('/api/profile/password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);
    const ok = await second.post('/api/profile/password', { currentPassword: PASSWORD, newPassword: 'another-long-pass' });
    expect(ok.status).toBe(204);
    expect((await first.get('/api/auth/me')).status).toBe(401);
    expect((await second.get('/api/auth/me')).status).toBe(200);
    const relogin = await request(env.app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'another-long-pass' });
    expect(relogin.status).toBe(200);
  });
});
