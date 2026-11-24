export interface Config {
  port: number;
  dbPath: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string | undefined;
  secureCookies: boolean;
  trustProxy: boolean;
  sessionTtlHours: number;
  runWorkerInProcess: boolean;
  workerIntervalMs: number;
  staticDir: string;
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v === 'true');
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 3000),
    dbPath: env.DB_PATH || 'data/todo.db',
    adminName: env.ADMIN_NAME || 'Owner',
    adminEmail: env.ADMIN_EMAIL || 'owner@example.com',
    adminPassword: env.ADMIN_PASSWORD || undefined,
    secureCookies: bool(env.SECURE_COOKIES, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    sessionTtlHours: num(env.SESSION_TTL_HOURS, 24),
    runWorkerInProcess: (env.WORKER_MODE ?? 'internal') !== 'external',
    workerIntervalMs: num(env.WORKER_INTERVAL_MS, 15000),
    staticDir: env.STATIC_DIR || 'client/dist',
  };
}
