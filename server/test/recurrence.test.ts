import { beforeEach, describe, expect, it } from 'vitest';
import { nextOccurrence } from '../src/tasks/recurrence.js';
import { login, setup, type Client, type TestEnv } from './helpers.js';

describe('nextOccurrence', () => {
  it('advances daily, weekly and monthly in UTC', () => {
    expect(nextOccurrence('2026-01-15T10:00:00.000Z', 'daily', 'UTC')).toBe('2026-01-16T10:00:00.000Z');
    expect(nextOccurrence('2026-01-15T10:00:00.000Z', 'weekly', 'UTC')).toBe('2026-01-22T10:00:00.000Z');
    expect(nextOccurrence('2026-01-15T10:00:00.000Z', 'monthly', 'UTC')).toBe('2026-02-15T10:00:00.000Z');
  });

  it('clamps monthly recurrence to the last day of shorter months and rolls over the year', () => {
    expect(nextOccurrence('2026-01-31T10:00:00.000Z', 'monthly', 'UTC')).toBe('2026-02-28T10:00:00.000Z');
    expect(nextOccurrence('2026-12-20T10:00:00.000Z', 'monthly', 'UTC')).toBe('2027-01-20T10:00:00.000Z');
    expect(nextOccurrence('2028-01-31T10:00:00.000Z', 'monthly', 'UTC')).toBe('2028-02-29T10:00:00.000Z');
  });

  it('keeps local wall-clock time across the spring-forward DST change', () => {
    // 09:00 EST on 2026-03-07 -> 09:00 EDT on 2026-03-08 (offset changes from -5 to -4)
    expect(nextOccurrence('2026-03-07T14:00:00.000Z', 'daily', 'America/New_York')).toBe('2026-03-08T13:00:00.000Z');
  });

  it('keeps local wall-clock time across the fall-back DST change', () => {
    expect(nextOccurrence('2026-10-31T13:00:00.000Z', 'weekly', 'America/New_York')).toBe('2026-11-07T14:00:00.000Z');
  });

  it('handles zones with half-hour offsets and a local date that differs from UTC', () => {
    // 2026-01-15 23:30 IST == 18:00Z; next day 23:30 IST == 2026-01-16T18:00Z
    expect(nextOccurrence('2026-01-15T18:00:00.000Z', 'daily', 'Asia/Kolkata')).toBe('2026-01-16T18:00:00.000Z');
  });
});

describe('recurring tasks (FR-009, AC-005)', () => {
  let env: TestEnv;
  let c: Client;
  beforeEach(async () => {
    env = await setup();
    c = await login(env.app);
  });

  const all = async () => (await c.get('/api/tasks?sort=due')).body.items as { id: number; title: string; status: string; dueAt: string; checklist: { done: boolean }[]; reminders: { leadMinutes: number; status: string }[] }[];

  it('requires a due date', async () => {
    expect((await c.post('/api/tasks', { title: 'Water plants', recurrence: 'daily' })).status).toBe(400);
  });

  it('generates the next occurrence once on completion, copying checklist and reminders', async () => {
    const t = (await c.post('/api/tasks', { title: 'Water plants', recurrence: 'weekly', dueAt: '2026-01-20T08:00:00Z' })).body;
    const withItem = (await c.post(`/api/tasks/${t.id}/checklist`, { text: 'Fern' })).body;
    await c.patch(`/api/checklist/${withItem.checklist[0].id}`, { done: true });
    await c.post(`/api/tasks/${t.id}/reminders`, { leadMinutes: 30, channels: ['in_app'] });

    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    let tasks = await all();
    expect(tasks).toHaveLength(2);
    const next = tasks.find((x) => x.id !== t.id)!;
    expect(next).toMatchObject({ status: 'pending', dueAt: '2026-01-27T08:00:00.000Z' });
    expect(next.checklist).toEqual([{ id: expect.any(Number), text: 'Fern', done: false }]);
    expect(next.reminders).toMatchObject([{ leadMinutes: 30, status: 'pending' }]);

    await c.patch(`/api/tasks/${t.id}`, { status: 'pending' });
    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    tasks = await all();
    expect(tasks).toHaveLength(2);

    const n = (await c.get('/api/notifications')).body;
    expect(n.items[0]).toMatchObject({ title: 'Next occurrence created', taskId: next.id });
  });

  it('deleting one occurrence does not remove the generated next one', async () => {
    const t = (await c.post('/api/tasks', { title: 'Stretch', recurrence: 'daily', dueAt: '2026-01-20T08:00:00Z' })).body;
    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    await c.del(`/api/tasks/${t.id}`);
    const left = await all();
    expect(left).toHaveLength(1);
    expect(left[0]!.dueAt).toBe('2026-01-21T08:00:00.000Z');
  });

  it('uses the profile time zone for wall-clock recurrence', async () => {
    await c.patch('/api/profile', { timeZone: 'America/New_York' });
    const t = (await c.post('/api/tasks', { title: 'Standup', recurrence: 'daily', dueAt: '2026-03-07T14:00:00Z' })).body;
    await c.patch(`/api/tasks/${t.id}`, { status: 'completed' });
    expect((await all()).find((x) => x.id !== t.id)!.dueAt).toBe('2026-03-08T13:00:00.000Z');
  });
});
