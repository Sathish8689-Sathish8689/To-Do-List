import request from 'supertest';
import type { Express } from 'express';
import { createApp, createContext } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { loadConfig } from '../src/config.js';
import { openDb, type DB } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import type { Channel, ChannelAdapter, DeliveryMessage } from '../src/notifications/adapters.js';
import { addNotification } from '../src/notifications/adapters.js';

export const PASSWORD = 'correct-horse-battery';

export interface TestEnv {
  db: DB;
  app: Express;
  clock: { now: Date };
  sent: { channel: Channel; message: DeliveryMessage }[];
  failing: Set<Channel>;
  adapters: Record<Channel, ChannelAdapter>;
  ctx: ReturnType<typeof createContext>;
}

export async function createUser(db: DB, email: string, name = 'Tester'): Promise<number> {
  const r = db
    .prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, email, await hashPassword(PASSWORD), new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export async function setup(
  start = '2026-01-15T12:00:00.000Z',
  options: { trustProxy?: boolean } = {},
): Promise<TestEnv> {
  const db = openDb(':memory:');
  const logger = createLogger('silent');
  const clock = { now: new Date(start) };
  const sent: TestEnv['sent'] = [];
  const failing = new Set<Channel>();
  const make = (channel: Channel): ChannelAdapter => ({
    async send(message, now) {
      if (failing.has(channel)) throw new Error(`${channel} provider down`);
      sent.push({ channel, message });
      if (channel === 'in_app') addNotification(db, message.userId, message.taskId, message.title, message.body, now);
    },
  });
  const adapters = { in_app: make('in_app'), email: make('email'), push: make('push') };
  await createUser(db, 'owner@example.com', 'Owner');
  const ctx = createContext({
    db,
    config: loadConfig({ TRUST_PROXY: options.trustProxy ? 'true' : 'false' }),
    logger,
    adapters,
    now: () => clock.now,
  });
  return { db, app: createApp(ctx), clock, sent, failing, adapters, ctx };
}

export interface Client {
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
  patch(path: string, body: object): request.Test;
  del(path: string): request.Test;
  csrf: string;
}

export async function login(app: Express, email = 'owner@example.com'): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const csrf = res.body.csrfToken as string;
  return {
    csrf,
    get: (p) => agent.get(p),
    post: (p, b) => agent.post(p).set('x-csrf-token', csrf).send(b ?? {}),
    patch: (p, b) => agent.patch(p).set('x-csrf-token', csrf).send(b),
    del: (p) => agent.delete(p).set('x-csrf-token', csrf),
  };
}
