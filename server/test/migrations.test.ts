import { describe, expect, it } from 'vitest';
import { migrate, migrations, openDb, rollbackLast } from '../src/db.js';

describe('migrations', () => {
  const tables = (db: ReturnType<typeof openDb>) =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as { name: string }[]).map((r) => r.name);

  it('applies idempotently and rolls back cleanly', () => {
    const db = openDb(':memory:');
    migrate(db);
    expect(tables(db)).toEqual(
      ['categories', 'checklist_items', 'deliveries', 'meta', 'notifications', 'reminders', 'schema_migrations', 'sessions', 'tasks', 'users'],
    );
    expect(rollbackLast(db)).toBe(migrations.at(-1)!.version);
    expect(tables(db)).toEqual(['schema_migrations']);
    expect(rollbackLast(db)).toBeNull();
    migrate(db);
    expect(tables(db)).toContain('tasks');
  });
});
