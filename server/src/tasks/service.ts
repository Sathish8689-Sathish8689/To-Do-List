import { tx, type DB } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { addNotification, type Channel } from '../notifications/adapters.js';
import { nextOccurrence, type Recurrence } from './recurrence.js';
import { remindAtFor, syncReminders } from './reminders.js';
import type { CreateTaskInput, ListQuery, UpdateTaskInput } from './schemas.js';

export interface TaskRow {
  id: number;
  user_id: number;
  parent_id: number | null;
  title: string;
  description: string;
  status: 'pending' | 'completed';
  priority: 'high' | 'medium' | 'low';
  due_at: string | null;
  category_id: number | null;
  category_name: string | null;
  recurrence: Recurrence | null;
  recurrence_spawned: number;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDto {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  status: 'pending' | 'completed';
  priority: 'high' | 'medium' | 'low';
  dueAt: string | null;
  categoryId: number | null;
  categoryName: string | null;
  recurrence: Recurrence | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  checklist: { id: number; text: string; done: boolean }[];
  reminders: { id: number; leadMinutes: number; channels: Channel[]; remindAt: string; status: string }[];
  subtasks: TaskDto[];
}

const TASK_SELECT = `SELECT t.*, c.name AS category_name FROM tasks t LEFT JOIN categories c ON c.id = t.category_id`;

function loadRow(db: DB, userId: number, id: number): TaskRow {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.user_id = ?`).get(id, userId) as unknown as
    | TaskRow
    | undefined;
  if (!row) throw notFound('Task');
  return row;
}

function toDto(db: DB, row: TaskRow, withSubtasks = true): TaskDto {
  const checklist = db
    .prepare('SELECT id, text, done FROM checklist_items WHERE task_id = ? ORDER BY position, id')
    .all(row.id) as unknown as { id: number; text: string; done: number }[];
  const reminders = db
    .prepare('SELECT id, lead_minutes, channels, remind_at, status FROM reminders WHERE task_id = ? ORDER BY remind_at, id')
    .all(row.id) as unknown as {
    id: number;
    lead_minutes: number;
    channels: string;
    remind_at: string;
    status: string;
  }[];
  const subtasks =
    withSubtasks && row.parent_id === null
      ? (db.prepare(`${TASK_SELECT} WHERE t.parent_id = ? ORDER BY t.id`).all(row.id) as unknown as TaskRow[]).map((s) =>
          toDto(db, s, false),
        )
      : [];
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    categoryId: row.category_id,
    categoryName: row.category_name,
    recurrence: row.recurrence,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checklist: checklist.map((c) => ({ id: c.id, text: c.text, done: c.done === 1 })),
    reminders: reminders.map((r) => ({
      id: r.id,
      leadMinutes: r.lead_minutes,
      channels: JSON.parse(r.channels) as Channel[],
      remindAt: r.remind_at,
      status: r.status,
    })),
    subtasks,
  };
}

function assertCategory(db: DB, userId: number, categoryId: number | null): void {
  if (categoryId === null) return;
  const found = db.prepare('SELECT 1 AS ok FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
  if (!found) throw badRequest('Category does not exist', [{ path: 'categoryId', message: 'Unknown category' }]);
}

export function getTask(db: DB, userId: number, id: number): TaskDto {
  return toDto(db, loadRow(db, userId, id));
}

export function createTask(db: DB, userId: number, input: CreateTaskInput, now: Date): TaskDto {
  const id = tx(db, () => {
    assertCategory(db, userId, input.categoryId);
    if (input.parentId !== null) {
      const parent = loadRow(db, userId, input.parentId);
      if (parent.parent_id !== null) throw badRequest('Subtasks can only be one level deep');
      if (parent.archived_at) throw conflict('TASK_ARCHIVED', 'Restore the task before adding subtasks');
      if (input.categoryId !== null || input.recurrence !== null) {
        throw badRequest('Subtasks cannot have a category or recurrence');
      }
    }
    if (input.recurrence && !input.dueAt) throw badRequest('A recurring task needs a due date');
    const ts = now.toISOString();
    const result = db
      .prepare(
        `INSERT INTO tasks (user_id, parent_id, title, description, priority, due_at, category_id, recurrence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, input.parentId, input.title, input.description, input.priority, input.dueAt, input.categoryId, input.recurrence, ts, ts);
    return Number(result.lastInsertRowid);
  });
  return getTask(db, userId, id);
}

export function updateTask(db: DB, userId: number, id: number, patch: UpdateTaskInput, now: Date): TaskDto {
  tx(db, () => {
    const row = loadRow(db, userId, id);
    if (row.archived_at) throw conflict('TASK_ARCHIVED', 'Restore the task before editing it');
    const next = {
      title: patch.title ?? row.title,
      description: patch.description ?? row.description,
      priority: patch.priority ?? row.priority,
      dueAt: patch.dueAt !== undefined ? patch.dueAt : row.due_at,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : row.category_id,
      recurrence: patch.recurrence !== undefined ? patch.recurrence : row.recurrence,
      status: patch.status ?? row.status,
    };
    if (row.parent_id !== null && (next.categoryId !== null || next.recurrence !== null)) {
      throw badRequest('Subtasks cannot have a category or recurrence');
    }
    if (next.recurrence && !next.dueAt) throw badRequest('A recurring task needs a due date');
    assertCategory(db, userId, next.categoryId);

    const statusChanged = next.status !== row.status;
    const completedAt = statusChanged ? (next.status === 'completed' ? now.toISOString() : null) : row.completed_at;
    db.prepare(
      `UPDATE tasks SET title = ?, description = ?, priority = ?, due_at = ?, category_id = ?, recurrence = ?,
         status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(next.title, next.description, next.priority, next.dueAt, next.categoryId, next.recurrence, next.status, completedAt, now.toISOString(), id);

    if (statusChanged && next.status === 'completed' && next.recurrence && next.dueAt && row.parent_id === null && row.recurrence_spawned === 0) {
      spawnNextOccurrence(db, userId, id, next.title, next.dueAt, next.recurrence, now);
    }
    syncReminders(db, id, now);
  });
  return getTask(db, userId, id);
}

function spawnNextOccurrence(
  db: DB,
  userId: number,
  sourceId: number,
  title: string,
  dueAt: string,
  rule: Recurrence,
  now: Date,
): void {
  const user = db.prepare('SELECT time_zone, notify_in_app FROM users WHERE id = ?').get(userId) as unknown as {
    time_zone: string;
    notify_in_app: number;
  };
  const due = nextOccurrence(dueAt, rule, user.time_zone);
  const ts = now.toISOString();
  const result = db
    .prepare(
      `INSERT INTO tasks (user_id, title, description, priority, due_at, category_id, recurrence, created_at, updated_at)
       SELECT user_id, title, description, priority, ?, category_id, recurrence, ?, ? FROM tasks WHERE id = ?`,
    )
    .run(due, ts, ts, sourceId);
  const newId = Number(result.lastInsertRowid);
  db.prepare(
    'INSERT INTO checklist_items (task_id, text, done, position) SELECT ?, text, 0, position FROM checklist_items WHERE task_id = ?',
  ).run(newId, sourceId);
  const reminders = db
    .prepare('SELECT lead_minutes, channels FROM reminders WHERE task_id = ?')
    .all(sourceId) as unknown as { lead_minutes: number; channels: string }[];
  for (const r of reminders) {
    const at = remindAtFor(due, r.lead_minutes);
    db.prepare(
      'INSERT INTO reminders (task_id, lead_minutes, channels, remind_at, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(newId, r.lead_minutes, r.channels, at, at, ts);
  }
  syncReminders(db, newId, now);
  db.prepare('UPDATE tasks SET recurrence_spawned = 1 WHERE id = ?').run(sourceId);
  if (user.notify_in_app === 1) {
    addNotification(db, userId, newId, 'Next occurrence created', `"${title}" repeats ${rule}; the next one is scheduled.`, now);
  }
}

export function deleteTask(db: DB, userId: number, id: number): void {
  loadRow(db, userId, id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function archiveTask(db: DB, userId: number, id: number, now: Date): TaskDto {
  tx(db, () => {
    const row = loadRow(db, userId, id);
    if (row.parent_id !== null) throw badRequest('Only top-level tasks can be archived');
    if (row.archived_at) throw conflict('ALREADY_ARCHIVED', 'Task is already archived');
    if (row.status !== 'completed') throw conflict('NOT_COMPLETED', 'Only completed tasks can be archived');
    db.prepare('UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), id);
    syncReminders(db, id, now);
  });
  return getTask(db, userId, id);
}

export function restoreTask(db: DB, userId: number, id: number, now: Date): TaskDto {
  tx(db, () => {
    const row = loadRow(db, userId, id);
    if (!row.archived_at) throw conflict('NOT_ARCHIVED', 'Task is not archived');
    db.prepare('UPDATE tasks SET archived_at = NULL, updated_at = ? WHERE id = ?').run(now.toISOString(), id);
    syncReminders(db, id, now);
  });
  return getTask(db, userId, id);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const SORTS = {
  status: (dir: string) => `CASE t.status WHEN 'pending' THEN 0 ELSE 1 END ${dir}`,
  priority: (dir: string) => `CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ${dir}`,
  category: (dir: string) => `(c.name IS NULL) ASC, c.name COLLATE NOCASE ${dir}`,
  due: (dir: string) => `(t.due_at IS NULL) ASC, t.due_at ${dir}`,
} as const;

export function listTasks(db: DB, userId: number, q: ListQuery) {
  const where: string[] = ['t.user_id = ?', 't.parent_id IS NULL', q.archived === 'true' ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL'];
  const params: (string | number)[] = [userId];
  if (q.status) (where.push('t.status = ?'), params.push(q.status));
  if (q.priority) (where.push('t.priority = ?'), params.push(q.priority));
  if (q.categoryId) (where.push('t.category_id = ?'), params.push(q.categoryId));
  if (q.uncategorized === 'true') where.push('t.category_id IS NULL');
  if (q.dueFrom) (where.push('t.due_at >= ?'), params.push(q.dueFrom));
  if (q.dueTo) (where.push('t.due_at < ?'), params.push(q.dueTo));
  if (q.search) {
    const like = `%${escapeLike(q.search)}%`;
    where.push(
      `(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM tasks s WHERE s.parent_id = t.id AND (s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')))`,
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM tasks t LEFT JOIN categories c ON c.id = t.category_id WHERE ${whereSql}`)
    .get(...params) as unknown as { total: number };
  const rows = db
    .prepare(`${TASK_SELECT} WHERE ${whereSql} ORDER BY ${SORTS[q.sort](dir)}, t.id ASC LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as unknown as TaskRow[];
  return { items: rows.map((r) => toDto(db, r)), total, page: q.page, pageSize: q.pageSize };
}

export function addChecklistItem(db: DB, userId: number, taskId: number, text: string): TaskDto {
  const row = loadRow(db, userId, taskId);
  if (row.archived_at) throw conflict('TASK_ARCHIVED', 'Restore the task before editing it');
  const { next } = db
    .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM checklist_items WHERE task_id = ?')
    .get(taskId) as unknown as { next: number };
  db.prepare('INSERT INTO checklist_items (task_id, text, position) VALUES (?, ?, ?)').run(taskId, text, next);
  return toDto(db, row);
}

function loadChecklistOwner(db: DB, userId: number, itemId: number): number {
  const row = db
    .prepare(
      'SELECT t.id AS task_id, t.archived_at FROM checklist_items i JOIN tasks t ON t.id = i.task_id WHERE i.id = ? AND t.user_id = ?',
    )
    .get(itemId, userId) as unknown as { task_id: number; archived_at: string | null } | undefined;
  if (!row) throw notFound('Checklist item');
  if (row.archived_at) throw conflict('TASK_ARCHIVED', 'Restore the task before editing it');
  return row.task_id;
}

export function updateChecklistItem(
  db: DB,
  userId: number,
  itemId: number,
  patch: { text?: string; done?: boolean },
): TaskDto {
  const taskId = loadChecklistOwner(db, userId, itemId);
  if (patch.text !== undefined) db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(patch.text, itemId);
  if (patch.done !== undefined) db.prepare('UPDATE checklist_items SET done = ? WHERE id = ?').run(patch.done ? 1 : 0, itemId);
  return getTask(db, userId, taskId);
}

export function deleteChecklistItem(db: DB, userId: number, itemId: number): TaskDto {
  const taskId = loadChecklistOwner(db, userId, itemId);
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(itemId);
  return getTask(db, userId, taskId);
}

export function addReminder(
  db: DB,
  userId: number,
  taskId: number,
  input: { leadMinutes: number; channels: Channel[] },
  now: Date,
): TaskDto {
  const row = loadRow(db, userId, taskId);
  if (row.archived_at || row.status !== 'pending') {
    throw conflict('TASK_NOT_ACTIVE', 'Reminders can only be set on active, pending tasks');
  }
  if (!row.due_at) throw badRequest('Set a due date before adding a reminder');
  const at = remindAtFor(row.due_at, input.leadMinutes);
  if (at <= now.toISOString()) throw badRequest('The reminder time is already in the past');
  db.prepare(
    'INSERT INTO reminders (task_id, lead_minutes, channels, remind_at, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(taskId, input.leadMinutes, JSON.stringify([...new Set(input.channels)]), at, at, now.toISOString());
  return toDto(db, row);
}

export function deleteReminder(db: DB, userId: number, reminderId: number): TaskDto {
  const owner = db
    .prepare('SELECT t.id AS task_id FROM reminders r JOIN tasks t ON t.id = r.task_id WHERE r.id = ? AND t.user_id = ?')
    .get(reminderId, userId) as unknown as { task_id: number } | undefined;
  if (!owner) throw notFound('Reminder');
  db.prepare('DELETE FROM reminders WHERE id = ?').run(reminderId);
  return getTask(db, userId, owner.task_id);
}

export function dashboard(db: DB, userId: number, now: Date) {
  const count = (sql: string, ...p: (string | number)[]) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND parent_id IS NULL AND ${sql}`).get(userId, ...p) as unknown as { n: number }).n;
  return {
    pending: count("status = 'pending' AND archived_at IS NULL"),
    completed: count("status = 'completed'"),
    overdue: count("status = 'pending' AND archived_at IS NULL AND due_at IS NOT NULL AND due_at < ?", now.toISOString()),
    archived: count('archived_at IS NOT NULL'),
  };
}
