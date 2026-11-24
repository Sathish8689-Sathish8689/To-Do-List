import type { DB } from '../db.js';
import type { Logger } from '../logger.js';
import { runDueReminders, type DispatcherDeps } from './dispatcher.js';

export const HEARTBEAT_KEY = 'worker_heartbeat';

export function readHeartbeat(db: DB): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(HEARTBEAT_KEY) as unknown as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function startWorker(deps: DispatcherDeps, intervalMs: number): () => void {
  const logger: Logger = deps.logger;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = (deps.now ?? (() => new Date()))().toISOString();
      deps.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(HEARTBEAT_KEY, now);
      const handled = await runDueReminders(deps);
      if (handled > 0) logger.info('worker_tick', { handled });
    } catch (err) {
      logger.error('worker_error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
