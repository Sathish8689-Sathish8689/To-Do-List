import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, login, setup, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
let c: Client;
beforeEach(async () => {
  env = await setup();
  c = await login(env.app);
});

const make = async (body: object) => (await c.post('/api/tasks', body)).body;

describe('task CRUD and status (FR-001–FR-003, AC-001, AC-002)', () => {
  it('creates, views, edits, completes and reopens a task', async () => {
    const created = await c.post('/api/tasks', { title: '  Write report  ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: 'Write report', status: 'pending', priority: 'medium', description: '' });

    const id = created.body.id;
    expect((await c.get(`/api/tasks/${id}`)).body.title).toBe('Write report');

    const edited = await c.patch(`/api/tasks/${id}`, { title: 'Write final report', description: 'Q4' });
    expect(edited.body).toMatchObject({ title: 'Write final report', description: 'Q4' });

    const done = await c.patch(`/api/tasks/${id}`, { status: 'completed' });
    expect(done.body.status).toBe('completed');
    expect(done.body.completedAt).toBe(env.clock.now.toISOString());

    const reopened = await c.patch(`/api/tasks/${id}`, { status: 'pending' });
    expect(reopened.body).toMatchObject({ status: 'pending', completedAt: null });
  });

  it('permanently deletes a task with its subtasks, checklist and reminders', async () => {
    const t = await make({ title: 'Parent', dueAt: '2026-02-01T10:00:00Z' });
    await make({ title: 'Child', parentId: t.id });
    await c.post(`/api/tasks/${t.id}/checklist`, { text: 'item' });
    await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 10, channels: ['in_app'] });

    expect((await c.del(`/api/tasks/${t.id}`)).status).toBe(204);
    expect((await c.get(`/api/tasks/${t.id}`)).status).toBe(404);
    const count = (table: string) =>
      (env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }).n;
    expect(count('tasks')).toBe(0);
    expect(count('checklist_items')).toBe(0);
    expect(count('reminders')).toBe(0);
  });

  it('validates input with field-level errors', async () => {
    const res = await c.post('/api/tasks', { title: '   ', priority: 'urgent', dueAt: 'tomorrow' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['dueAt', 'priority', 'title']);
    expect((await c.patch('/api/tasks/1', {})).status).toBe(400);
  });

  it('returns 404 for invalid or unknown ids', async () => {
    expect((await c.get('/api/tasks/abc')).status).toBe(404);
    expect((await c.get('/api/tasks/9999')).status).toBe(404);
  });
});

describe('task attributes and categories (FR-004, FR-005, AC-003)', () => {
  it('stores description, due date, priority and category', async () => {
    const cat = (await c.post('/api/categories', { name: 'Work' })).body;
    const t = await make({
      title: 'Plan',
      description: 'details',
      priority: 'high',
      dueAt: '2026-03-01T09:30:00+05:30',
      categoryId: cat.id,
    });
    expect(t).toMatchObject({ description: 'details', priority: 'high', dueAt: '2026-03-01T04:00:00.000Z', categoryId: cat.id, categoryName: 'Work' });
  });

  it('manages categories: unique names, rename, delete leaves tasks uncategorized', async () => {
    const cat = (await c.post('/api/categories', { name: 'Home' })).body;
    expect((await c.post('/api/categories', { name: 'home' })).status).toBe(409);
    expect((await c.patch(`/api/categories/${cat.id}`, { name: 'House' })).body.name).toBe('House');
    const t = await make({ title: 'Clean', categoryId: cat.id });
    expect((await c.del(`/api/categories/${cat.id}`)).status).toBe(204);
    expect((await c.get(`/api/tasks/${t.id}`)).body).toMatchObject({ categoryId: null, categoryName: null });
    expect((await c.get('/api/categories')).body.items).toEqual([]);
  });

  it('rejects an unknown category', async () => {
    expect((await c.post('/api/tasks', { title: 'x', categoryId: 999 })).status).toBe(400);
  });
});

describe('subtasks and checklists (FR-006, FR-007, AC-004)', () => {
  it('stores subtasks under the parent, one level deep, without category or recurrence', async () => {
    const p = await make({ title: 'Parent' });
    const s = await c.post('/api/tasks', { title: 'Sub', parentId: p.id });
    expect(s.status).toBe(201);
    expect((await c.post('/api/tasks', { title: 'Nested', parentId: s.body.id })).status).toBe(400);
    expect((await c.post('/api/tasks', { title: 'Rec', parentId: p.id, recurrence: 'daily', dueAt: '2026-02-01T00:00:00Z' })).status).toBe(400);

    const parent = (await c.get(`/api/tasks/${p.id}`)).body;
    expect(parent.subtasks.map((x: { title: string }) => x.title)).toEqual(['Sub']);
    const list = (await c.get('/api/tasks')).body;
    expect(list.items.map((x: { title: string }) => x.title)).toEqual(['Parent']);
  });

  it('manages checklist items', async () => {
    const t = await make({ title: 'Trip' });
    const added = await c.post(`/api/tasks/${t.id}/checklist`, { text: 'Passport' });
    expect(added.body.checklist).toHaveLength(1);
    const itemId = added.body.checklist[0].id;
    const toggled = await c.patch(`/api/checklist/${itemId}`, { done: true });
    expect(toggled.body.checklist[0]).toMatchObject({ text: 'Passport', done: true });
    const removed = await c.del(`/api/checklist/${itemId}`);
    expect(removed.body.checklist).toEqual([]);
    expect((await c.post(`/api/tasks/${t.id}/checklist`, { text: '' })).status).toBe(400);
  });
});

describe('search, filter, sort and calendar range (FR-010–FR-013, AC-006, AC-007)', () => {
  beforeEach(async () => {
    const work = (await c.post('/api/categories', { name: 'Work' })).body;
    const home = (await c.post('/api/categories', { name: 'Home' })).body;
    await make({ title: 'Buy milk', priority: 'low', categoryId: home.id, dueAt: '2026-02-03T10:00:00Z' });
    await make({ title: 'Quarterly report', description: 'finance numbers', priority: 'high', categoryId: work.id, dueAt: '2026-02-01T10:00:00Z' });
    const done = await make({ title: 'Email boss', priority: 'medium', categoryId: work.id, dueAt: '2026-02-02T10:00:00Z' });
    await c.patch(`/api/tasks/${done.id}`, { status: 'completed' });
    const parent = await make({ title: 'Move house' });
    await make({ title: 'Rent a van', parentId: parent.id });
    await make({ title: 'No date task', priority: 'medium' });
  });

  const titles = async (qs: string) => ((await c.get(`/api/tasks?${qs}`)).body.items as { title: string }[]).map((t) => t.title);

  it('searches title, description, category name and subtasks, escaping wildcards', async () => {
    expect(await titles('search=milk')).toEqual(['Buy milk']);
    expect(await titles('search=finance')).toEqual(['Quarterly report']);
    expect(await titles('search=home')).toEqual(['Buy milk']);
    expect(await titles('search=van')).toEqual(['Move house']);
    expect(await titles('search=%25')).toEqual([]);
  });

  it('filters by status, priority, category and due range', async () => {
    expect(await titles('status=completed')).toEqual(['Email boss']);
    expect(await titles('priority=high')).toEqual(['Quarterly report']);
    const cats = (await c.get('/api/categories')).body.items as { id: number; name: string }[];
    const work = cats.find((x) => x.name === 'Work')!;
    expect(await titles(`categoryId=${work.id}&sort=due`)).toEqual(['Quarterly report', 'Email boss']);
    expect(await titles('dueFrom=2026-02-02T00:00:00Z&dueTo=2026-02-03T00:00:00Z')).toEqual(['Email boss']);
    expect(await titles('uncategorized=true&sort=due')).toEqual(['Move house', 'No date task']);
  });

  it('sorts by due, priority, status and category, with undated tasks last', async () => {
    expect(await titles('sort=due')).toEqual(['Quarterly report', 'Email boss', 'Buy milk', 'Move house', 'No date task']);
    expect((await titles('sort=due&dir=desc'))[0]).toBe('Buy milk');
    expect((await titles('sort=priority'))[0]).toBe('Quarterly report');
    expect((await titles('sort=priority&dir=desc'))[0]).toBe('Buy milk');
    expect((await titles('sort=status')).at(-1)).toBe('Email boss');
    expect((await titles('sort=category')).slice(0, 2)).toEqual(['Buy milk', 'Quarterly report']);
  });

  it('paginates and rejects invalid query values', async () => {
    const page = (await c.get('/api/tasks?pageSize=2&page=2&sort=due')).body;
    expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect((await c.get('/api/tasks?sort=bogus')).status).toBe(400);
  });
});

describe('archive and restore (FR-015, AC-009)', () => {
  it('archives only completed tasks and restores them', async () => {
    const t = await make({ title: 'Finish' });
    expect((await c.post(`/api/tasks/${t.id}/archive`)).status).toBe(409);
    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    const archived = await c.post(`/api/tasks/${t.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).toBeTruthy();

    expect((await c.get('/api/tasks')).body.items).toEqual([]);
    expect((await c.get('/api/tasks?archived=true')).body.items).toHaveLength(1);
    expect((await c.patch(`/api/tasks/${t.id}`, { title: 'x' })).status).toBe(409);

    const restored = await c.post(`/api/tasks/${t.id}/restore`);
    expect(restored.body.archivedAt).toBeNull();
    expect((await c.get('/api/tasks')).body.items).toHaveLength(1);
    expect((await c.post(`/api/tasks/${t.id}/restore`)).status).toBe(409);
  });

  it('does not archive subtasks directly', async () => {
    const p = await make({ title: 'P' });
    const s = await make({ title: 'S', parentId: p.id });
    await c.patch(`/api/tasks/${s.id}`, { status: 'completed' });
    expect((await c.post(`/api/tasks/${s.id}/archive`)).status).toBe(400);
  });
});

describe('dashboard (FR-014, AC-008)', () => {
  it('counts pending, completed (including archived) and overdue top-level tasks', async () => {
    await make({ title: 'Overdue', dueAt: '2026-01-10T00:00:00Z' });
    await make({ title: 'Future', dueAt: '2026-02-10T00:00:00Z' });
    await make({ title: 'Undated' });
    const parent = await make({ title: 'Parent' });
    await make({ title: 'Subtask overdue', parentId: parent.id, dueAt: '2026-01-01T00:00:00Z' });
    const done = await make({ title: 'Done' });
    await c.patch(`/api/tasks/${done.id}`, { status: 'completed' });
    const archived = await make({ title: 'Archived' });
    await c.patch(`/api/tasks/${archived.id}`, { status: 'completed' });
    await c.post(`/api/tasks/${archived.id}/archive`);

    expect((await c.get('/api/dashboard')).body).toEqual({ pending: 4, completed: 2, overdue: 1, archived: 1 });
  });
});

describe('ownership isolation (NFR-002, AC-012)', () => {
  it("never exposes or modifies another user's data", async () => {
    const mine = await make({ title: 'Mine' });
    const cat = (await c.post('/api/categories', { name: 'Private' })).body;
    const item = (await c.post(`/api/tasks/${mine.id}/checklist`, { text: 'a' })).body.checklist[0];

    await createUser(env.db, 'second@example.com');
    const other = await login(env.app, 'second@example.com');

    expect((await other.get(`/api/tasks/${mine.id}`)).status).toBe(404);
    expect((await other.patch(`/api/tasks/${mine.id}`, { title: 'hax' })).status).toBe(404);
    expect((await other.del(`/api/tasks/${mine.id}`)).status).toBe(404);
    expect((await other.post(`/api/tasks/${mine.id}/archive`)).status).toBe(404);
    expect((await other.patch(`/api/checklist/${item.id}`, { done: true })).status).toBe(404);
    expect((await other.post('/api/tasks', { title: 'x', parentId: mine.id })).status).toBe(404);
    expect((await other.post('/api/tasks', { title: 'x', categoryId: cat.id })).status).toBe(400);
    expect((await other.del(`/api/categories/${cat.id}`)).status).toBe(404);
    expect((await other.get('/api/tasks')).body.items).toEqual([]);
    expect((await other.get('/api/categories')).body.items).toEqual([]);
    expect((await c.get(`/api/tasks/${mine.id}`)).body.title).toBe('Mine');
  });

  it('is not vulnerable to SQL injection through search and sort inputs', async () => {
    await make({ title: 'Safe' });
    const res = await c.get(`/api/tasks?search=${encodeURIComponent("' OR 1=1; DROP TABLE tasks;--")}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect((await c.get('/api/tasks?sort=due;DROP TABLE tasks')).status).toBe(400);
    expect((await c.get('/api/tasks')).body.items).toHaveLength(1);
  });
});
