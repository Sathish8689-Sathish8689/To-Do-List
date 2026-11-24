import type { DB } from '../db.js';

interface ReminderSyncRow {
  id: number;
  lead_minutes: number;
  remind_at: string;
  status: string;
}

interface TaskState {
  status: string;
  archived_at: string | null;
  due_at: string | null;
}

export const MAX_LEAD_MINUTES = 60 * 24 * 30;

export const remindAtFor = (dueIso: string, leadMinutes: number): string =>
  new Date(Date.parse(dueIso) - leadMinutes * 60_000).toISOString();

// Reminder lifecycle (D-06): cancel when the task is completed, archived or has no due date;
// recompute when the due date changes; re-arm when the task becomes active again.
export function syncReminders(db: DB, taskId: number, now: Date): void {
  const task = db
    .prepare('SELECT status, archived_at, due_at FROM tasks WHERE id = ?')
    .get(taskId) as unknown as TaskState | undefined;
  if (!task) return;
  const reminders = db
    .prepare('SELECT id, lead_minutes, remind_at, status FROM reminders WHERE task_id = ?')
    .all(taskId) as unknown as ReminderSyncRow[];
  const active = task.status === 'pending' && task.archived_at === null && task.due_at !== null;
  const nowIso = now.toISOString();

  for (const r of reminders) {
    if (!active) {
      if (r.status === 'pending' || r.status === 'claimed') {
        db.prepare("UPDATE reminders SET status = 'cancelled', claimed_until = NULL WHERE id = ?").run(r.id);
      }
      continue;
    }
    const target = remindAtFor(task.due_at!, r.lead_minutes);
    if (target === r.remind_at) {
      if (r.status === 'cancelled' && target > nowIso) {
        db.prepare("UPDATE reminders SET status = 'pending', next_attempt_at = ? WHERE id = ?").run(target, r.id);
      }
      continue;
    }
    if (target > nowIso) {
      db.prepare("DELETE FROM deliveries WHERE reminder_id = ?").run(r.id);
      db.prepare(
        "UPDATE reminders SET remind_at = ?, next_attempt_at = ?, status = 'pending', claimed_until = NULL WHERE id = ?",
      ).run(target, target, r.id);
    } else {
      db.prepare("UPDATE reminders SET remind_at = ?, status = 'cancelled', claimed_until = NULL WHERE id = ?").run(
        target,
        r.id,
      );
    }
  }
}

export function syncUserReminders(db: DB, userId: number, now: Date): void {
  const ids = db.prepare('SELECT id FROM tasks WHERE user_id = ?').all(userId) as unknown as { id: number }[];
  for (const { id } of ids) syncReminders(db, id, now);
}
