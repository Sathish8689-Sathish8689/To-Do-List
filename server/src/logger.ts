type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

// Structured JSON lines. Callers must never pass passwords, tokens, or email addresses.
export function createLogger(level: string | undefined = process.env.LOG_LEVEL): Logger {
  const min = level === 'silent' ? Infinity : (order[(level as Level) ?? 'info'] ?? order.info);
  const emit = (lvl: Level) => (msg: string, fields: Record<string, unknown> = {}) => {
    if (order[lvl] < min) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields });
    (lvl === 'error' ? process.stderr : process.stdout).write(line + '\n');
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
