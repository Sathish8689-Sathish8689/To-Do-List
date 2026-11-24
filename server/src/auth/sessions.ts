import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db.js';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  theme: 'light' | 'dark' | 'system';
  time_zone: string;
  default_view: 'list' | 'calendar' | 'dashboard';
  notify_in_app: number;
  notify_email: number;
  notify_push: number;
  created_at: string;
}

export const COOKIE_NAME = 'todo_session';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(db: DB, userId: number, ttlHours: number, now: Date) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hash(token), userId, csrfToken, expiresAt.toISOString(), now.toISOString());
  return { token, csrfToken, expiresAt };
}

export function findSession(db: DB, token: string, now: Date) {
  const row = db
    .prepare(
      `SELECT s.csrf_token AS csrf_token, u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hash(token), now.toISOString()) as unknown as (UserRow & { csrf_token: string }) | undefined;
  if (!row) return null;
  const { csrf_token, ...user } = row;
  return { user: user as UserRow, csrfToken: csrf_token };
}

export function destroySession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

export function destroyOtherSessions(db: DB, userId: number, keepToken: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, hash(keepToken));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
