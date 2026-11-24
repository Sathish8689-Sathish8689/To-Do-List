import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';
import { backoffMs, claimDueReminders, runDueReminders } from '../src/worker/dispatcher.js';
import { readHeartbeat, startWorker } from '../src/worker/loop.js';
import { login, setup, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
let c: Client;
const logger = createLogger('silent');
const run = (extra: object = {}) =>
  runDueReminders({ db: env.db, adapters: env.adapters, logger, now: () => env.clock.now, ...extra });
const advance = (ms: number) => (env.clock.now = new Date(env.clock.now.getTime() + ms));
const reminder = (id = 1) =>
  env.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as unknown as {
    status: string;
    remind_at: string;
    next_attempt_at: string;
  };
const deliveries = () =>
  env.db.prepare('SELECT channel, status, attempts FROM deliveries ORDER BY channel').all() as unknown as {
    channel: string;
    status: string;
    attempts: number;
  }[];

// Now is 2026-01-15T12:00Z. Task due 13:00Z with a 30 minute reminder => fires at 12:30Z.
async function taskWithReminder(channels: string[] = ['in_app']) {
  const t = (await c.post('/api/tasks', { title: 'Call dentist', dueAt: '2026-01-15T13:00:00Z' })).body;
  await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 30, channels });
  return t as { id: number };
}

beforeEach(async () => {
  env = await setup();
  c = await login(env.app);
});

describe('reminder delivery (FR-008, AC-005)', () => {
  it('does nothing before the reminder time and delivers in-app once it is due', async () => {
    await taskWithReminder();
    expect(await run()).toBe(0);
    expect(env.sent).toHaveLength(0);

    advance(31 * 60_000);
    expect(await run()).toBe(1);
    expect(env.sent).toHaveLength(1);
    expect(reminder().status).toBe('sent');

    const n = (await c.get('/api/notifications')).body;
    expect(n.unreadCount).toBe(1);
    expect(n.items[0]).toMatchObject({ title: 'Reminder: Call dentist', readAt: null });
    expect(n.items[0].taskId).toBeTruthy();

    expect(await run()).toBe(0);
    expect(env.sent).toHaveLength(1);
  });

  it('delivers to each enabled channel and skips channels the user turned off', async () => {
    await c.patch('/api/profile', { notifications: { email: true, push: false } });
    await taskWithReminder(['in_app', 'email', 'push']);
    advance(31 * 60_000);
    await run();
    expect(env.sent.map((s) => s.channel).sort()).toEqual(['email', 'in_app']);
    expect(deliveries()).toEqual([
      { channel: 'email', status: 'sent', attempts: 0 },
      { channel: 'in_app', status: 'sent', attempts: 0 },
      { channel: 'push', status: 'skipped', attempts: 0 },
    ]);
  });

  it('retries a failing channel with backoff without repeating channels already delivered', async () => {
    await c.patch('/api/profile', { notifications: { email: true } });
    await taskWithReminder(['in_app', 'email']);
    env.failing.add('email');
    advance(31 * 60_000);
    await run();
    expect(reminder().status).toBe('pending');
    expect(deliveries().find((d) => d.channel === 'email')).toMatchObject({ status: 'pending', attempts: 1 });
    expect(reminder().next_attempt_at).toBe(new Date(env.clock.now.getTime() + backoffMs(1)).toISOString());

    expect(await run()).toBe(0);
    advance(backoffMs(1) + 1000);
    env.failing.clear();
    await run();
    expect(reminder().status).toBe('sent');
    expect(env.sent.filter((s) => s.channel === 'in_app')).toHaveLength(1);
    expect(env.sent.filter((s) => s.channel === 'email')).toHaveLength(1);
  });

  it('marks the reminder failed after the maximum attempts', async () => {
    await c.patch('/api/profile', { notifications: { email: true } });
    await taskWithReminder(['email']);
    env.failing.add('email');
    advance(31 * 60_000);
    for (let i = 0; i < 3; i++) {
      await run({ maxAttempts: 3 });
      advance(backoffMs(3) + 1000);
    }
    expect(reminder().status).toBe('failed');
    expect(deliveries()[0]).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('reclaims a reminder whose lease expired (worker crash) and avoids double claims', async () => {
    await taskWithReminder();
    advance(31 * 60_000);
    const first = claimDueReminders(env.db, env.clock.now, 60_000, 10);
    expect(first).toEqual([1]);
    expect(claimDueReminders(env.db, env.clock.now, 60_000, 10)).toEqual([]);
    advance(61_000);
    expect(claimDueReminders(env.db, env.clock.now, 60_000, 10)).toEqual([1]);
  });
});

describe('reminder lifecycle (FR-008, D-06)', () => {
  it('requires a due date, a future time, and active pending tasks', async () => {
    const noDue = (await c.post('/api/tasks', { title: 'x' })).body;
    expect((await c.post(`/api/tasks/${noDue.id}/reminders`, { leadMinutes: 5, channels: ['in_app'] })).status).toBe(400);
    const t = (await c.post('/api/tasks', { title: 'y', dueAt: '2026-01-15T12:10:00Z' })).body;
    expect((await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 30, channels: ['in_app'] })).status).toBe(400);
    expect((await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 5, channels: [] })).status).toBe(400);
    expect((await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 5, channels: ['sms'] })).status).toBe(400);
    expect((await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 999999, channels: ['in_app'] })).status).toBe(400);
  });

  it('cancels pending reminders when the task is completed and re-arms them if it is reopened', async () => {
    const t = await taskWithReminder();
    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    expect(reminder().status).toBe('cancelled');
    advance(31 * 60_000);
    await run();
    expect(env.sent).toHaveLength(0);

    env.clock.now = new Date('2026-01-15T12:00:00Z');
    await c.patch(`/api/tasks/${t.id}`, { status: 'pending' });
    expect(reminder().status).toBe('pending');
  });

  it('cancels on archive and delete, and recalculates when the due date changes', async () => {
    const t = await taskWithReminder();
    await c.patch(`/api/tasks/${t.id}`, { dueAt: '2026-01-15T15:00:00Z' });
    expect(reminder()).toMatchObject({ status: 'pending', remind_at: '2026-01-15T14:30:00.000Z' });

    await c.patch(`/api/tasks/${t.id}`, { dueAt: '2026-01-15T12:05:00Z' });
    expect(reminder().status).toBe('cancelled');

    await c.patch(`/api/tasks/${t.id}`, { dueAt: null });
    expect(reminder().status).toBe('cancelled');
    await c.patch(`/api/tasks/${t.id}`, { dueAt: '2026-01-15T16:00:00Z' });
    expect(reminder().status).toBe('pending');

    await c.del(`/api/tasks/${t.id}`);
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM reminders').get()).toEqual({ n: 0 });
  });

  it('does not fire for a task completed after the reminder was claimed', async () => {
    const t = await taskWithReminder();
    advance(31 * 60_000);
    claimDueReminders(env.db, env.clock.now, 60_000, 10);
    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    advance(61_000);
    await run();
    expect(env.sent).toHaveLength(0);
  });

  it('keeps a notification text-only when its task is deleted', async () => {
    const t = await taskWithReminder();
    advance(31 * 60_000);
    await run();
    await c.del(`/api/tasks/${t.id}`);
    const n = (await c.get('/api/notifications')).body;
    expect(n.items).toHaveLength(1);
    expect(n.items[0].taskId).toBeNull();
  });
});

describe('notifications API (FR-018, AC-011)', () => {
  it('marks notifications read individually and all at once', async () => {
    await taskWithReminder();
    advance(31 * 60_000);
    await run();
    const { items } = (await c.get('/api/notifications?unread=true')).body;
    expect(items).toHaveLength(1);
    expect((await c.post(`/api/notifications/${items[0].id}/read`)).status).toBe(204);
    expect((await c.get('/api/notifications')).body.unreadCount).toBe(0);
    expect((await c.post('/api/notifications/999/read')).status).toBe(404);
    expect((await c.post('/api/notifications/read-all')).status).toBe(204);
  });
});

describe('worker loop and health', () => {
  it('records a heartbeat that the health endpoint exposes', async () => {
    const res0 = await c.get('/api/health');
    expect(res0.body).toEqual({ status: 'ok', workerHeartbeat: null });
    const stop = startWorker({ db: env.db, adapters: env.adapters, logger, now: () => env.clock.now }, 60_000);
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(readHeartbeat(env.db)).toBe(env.clock.now.toISOString());
    expect((await c.get('/api/health')).body.workerHeartbeat).toBe(env.clock.now.toISOString());
  });
});
