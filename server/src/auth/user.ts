import type { DB } from '../db.js';
import type { Config } from '../config.js';
import { hashPassword } from './password.js';
import type { UserRow } from './sessions.js';

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    theme: u.theme,
    timeZone: u.time_zone,
    defaultView: u.default_view,
    notifications: {
      inApp: u.notify_in_app === 1,
      email: u.notify_email === 1,
      push: u.notify_push === 1,
    },
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Provisioning (D-01): one account is created from environment variables when the database has no users.
export async function ensureSeedUser(db: DB, config: Config, now: Date): Promise<boolean> {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as unknown as { n: number };
  if (n > 0) return false;
  if (!config.adminPassword || config.adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD (min 8 characters) must be set to create the initial account');
  }
  db.prepare(
    'INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(config.adminName, config.adminEmail, await hashPassword(config.adminPassword), now.toISOString());
  return true;
}
