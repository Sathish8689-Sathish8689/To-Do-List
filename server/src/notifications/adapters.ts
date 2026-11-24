import type { DB } from '../db.js';
import type { Logger } from '../logger.js';

export const CHANNELS = ['in_app', 'email', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface DeliveryMessage {
  userId: number;
  taskId: number | null;
  title: string;
  body: string;
  email: string;
}

export interface ChannelAdapter {
  send(message: DeliveryMessage, now: Date): Promise<void>;
}

export function addNotification(
  db: DB,
  userId: number,
  taskId: number | null,
  title: string,
  body: string,
  now: Date,
): void {
  db.prepare(
    'INSERT INTO notifications (user_id, task_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, taskId, title, body, now.toISOString());
}

// Email and push use console fakes until providers are confirmed (D-12); swap by implementing ChannelAdapter.
export function createAdapters(db: DB, logger: Logger): Record<Channel, ChannelAdapter> {
  const fake = (channel: string): ChannelAdapter => ({
    async send(message) {
      logger.info('fake_delivery', { channel, userId: message.userId, taskId: message.taskId });
    },
  });
  return {
    in_app: {
      async send(message, now) {
        addNotification(db, message.userId, message.taskId, message.title, message.body, now);
      },
    },
    email: fake('email'),
    push: fake('push'),
  };
}
