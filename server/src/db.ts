import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
        time_zone TEXT NOT NULL DEFAULT 'UTC',
        default_view TEXT NOT NULL DEFAULT 'list' CHECK (default_view IN ('list','calendar','dashboard')),
        notify_in_app INTEGER NOT NULL DEFAULT 1,
        notify_email INTEGER NOT NULL DEFAULT 0,
        notify_push INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        UNIQUE (user_id, name)
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
        due_at TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        recurrence TEXT CHECK (recurrence IN ('daily','weekly','monthly')),
        recurrence_spawned INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_user_parent ON tasks(user_id, parent_id);
      CREATE INDEX idx_tasks_due ON tasks(user_id, due_at);
      CREATE INDEX idx_tasks_parent ON tasks(parent_id);
      CREATE TABLE checklist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_checklist_task ON checklist_items(task_id);
      CREATE TABLE reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        lead_minutes INTEGER NOT NULL CHECK (lead_minutes >= 0),
        channels TEXT NOT NULL,
        remind_at TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','claimed','sent','failed','cancelled')),
        claimed_until TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_reminders_due ON reminders(status, next_attempt_at);
      CREATE INDEX idx_reminders_task ON reminders(task_id);
      CREATE TABLE deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        sent_at TEXT,
        UNIQUE (reminder_id, channel)
      );
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
    down: `
      DROP TABLE meta; DROP TABLE notifications; DROP TABLE deliveries; DROP TABLE reminders;
      DROP TABLE checklist_items; DROP TABLE tasks; DROP TABLE categories;
      DROP TABLE sessions; DROP TABLE users;
    `,
  },
];

export function migrate(db: DB, list: Migration[] = migrations): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as unknown as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  for (const m of list) {
    if (applied.has(m.version)) continue;
    tx(db, () => {
      db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
  }
}

export function rollbackLast(db: DB, list: Migration[] = migrations): number | null {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as unknown as { v: number | null };
  if (row.v === null) return null;
  const m = list.find((x) => x.version === row.v);
  if (!m) throw new Error(`Unknown migration version ${row.v}`);
  tx(db, () => {
    db.exec(m.down);
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(m.version);
  });
  return m.version;
}

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

// Not re-entrant: do not nest calls.
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
