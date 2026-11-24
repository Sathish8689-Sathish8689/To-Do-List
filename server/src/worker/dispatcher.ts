import type { DB } from '../db.js';
import type { Logger } from '../logger.js';
import { CHANNELS, type Channel, type ChannelAdapter } from '../notifications/adapters.js';

export interface DispatcherDeps {
  db: DB;
  adapters: Record<Channel, ChannelAdapter>;
  logger: Logger;
  now?: () => Date;
  leaseMs?: number;
  maxAttempts?: number;
  batchSize?: number;
}

interface ClaimedReminder {
  id: number;
  channels: string;
  task_id: number;
  title: string;
  status: string;
  archived_at: string | null;
  due_at: string | null;
  user_id: number;
  email: string;
  notify_in_app: number;
  notify_email: number;
  notify_push: number;
}

interface DeliveryRow {
  id: number;
  status: string;
  attempts: number;
}

const prefColumn: Record<Channel, 'notify_in_app' | 'notify_email' | 'notify_push'> = {
  in_app: 'notify_in_app',
  email: 'notify_email',
  push: 'notify_push',
};

export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 60 * 60_000);

// Claim/lease pattern (D-09): a reminder is claimed with an expiring lease via a conditional UPDATE, so no
// database lock is held while providers are called. Delivery is at-least-once; a crash after a provider
// accepted a message but before the delivery row is updated can cause one duplicate.
export function claimDueReminders(db: DB, now: Date, leaseMs: number, batchSize: number): number[] {
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const candidates = db
    .prepare(
      `SELECT id FROM reminders
       WHERE (status = 'pending' AND next_attempt_at <= ?) OR (status = 'claimed' AND claimed_until <= ?)
       ORDER BY next_attempt_at LIMIT ?`,
    )
    .all(nowIso, nowIso, batchSize) as unknown as { id: number }[];
  const claimed: number[] = [];
  for (const { id } of candidates) {
    const r = db
      .prepare(
        `UPDATE reminders SET status = 'claimed', claimed_until = ?
         WHERE id = ? AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'claimed' AND claimed_until <= ?))`,
      )
      .run(leaseUntil, id, nowIso, nowIso);
    if (r.changes === 1) claimed.push(id);
  }
  return claimed;
}

export async function runDueReminders(deps: DispatcherDeps): Promise<number> {
  const { db, adapters, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const maxAttempts = deps.maxAttempts ?? 5;
  const ids = claimDueReminders(db, now(), deps.leaseMs ?? 60_000, deps.batchSize ?? 50);

  for (const id of ids) {
    const r = db
      .prepare(
        `SELECT r.id, r.channels, r.task_id, t.title, t.status, t.archived_at, t.due_at,
                u.id AS user_id, u.email, u.notify_in_app, u.notify_email, u.notify_push
         FROM reminders r JOIN tasks t ON t.id = r.task_id JOIN users u ON u.id = t.user_id WHERE r.id = ?`,
      )
      .get(id) as unknown as ClaimedReminder | undefined;
    if (!r) continue;

    if (r.status !== 'pending' || r.archived_at !== null) {
      db.prepare("UPDATE reminders SET status = 'cancelled', claimed_until = NULL WHERE id = ? AND status = 'claimed'").run(id);
      continue;
    }

    const channels = (JSON.parse(r.channels) as string[]).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
    const message = {
      userId: r.user_id,
      taskId: r.task_id,
      title: `Reminder: ${r.title}`,
      body: r.due_at ? `"${r.title}" is due ${r.due_at}.` : `"${r.title}" has a reminder.`,
      email: r.email,
    };

    let anyPending = false;
    let anyFailed = false;
    let maxPendingAttempts = 0;

    for (const channel of channels) {
      db.prepare('INSERT OR IGNORE INTO deliveries (reminder_id, channel) VALUES (?, ?)').run(id, channel);
      const d = db
        .prepare('SELECT id, status, attempts FROM deliveries WHERE reminder_id = ? AND channel = ?')
        .get(id, channel) as unknown as DeliveryRow;
      if (d.status === 'failed') anyFailed = true;
      if (d.status !== 'pending') continue;

      if (r[prefColumn[channel]] !== 1) {
        db.prepare("UPDATE deliveries SET status = 'skipped' WHERE id = ?").run(d.id);
        continue;
      }
      try {
        await adapters[channel].send(message, now());
        db.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").run(now().toISOString(), d.id);
      } catch (err) {
        const attempts = d.attempts + 1;
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        const terminal = attempts >= maxAttempts;
        db.prepare('UPDATE deliveries SET attempts = ?, last_error = ?, status = ? WHERE id = ?').run(
          attempts,
          detail,
          terminal ? 'failed' : 'pending',
          d.id,
        );
        logger.warn('delivery_failed', { reminderId: id, channel, attempts, terminal });
        if (terminal) anyFailed = true;
        else {
          anyPending = true;
          maxPendingAttempts = Math.max(maxPendingAttempts, attempts);
        }
      }
    }

    if (anyPending) {
      const retryAt = new Date(now().getTime() + backoffMs(maxPendingAttempts)).toISOString();
      db.prepare("UPDATE reminders SET status = 'pending', next_attempt_at = ?, claimed_until = NULL WHERE id = ? AND status = 'claimed'").run(retryAt, id);
    } else {
      db.prepare("UPDATE reminders SET status = ?, claimed_until = NULL WHERE id = ? AND status = 'claimed'").run(anyFailed ? 'failed' : 'sent', id);
    }
  }
  return ids.length;
}
