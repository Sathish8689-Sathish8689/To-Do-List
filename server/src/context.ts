import type { DB } from './db.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { ChannelAdapter, Channel } from './notifications/adapters.js';
import type { RateLimiter } from './auth/rateLimit.js';

export interface AppContext {
  db: DB;
  config: Config;
  logger: Logger;
  adapters: Record<Channel, ChannelAdapter>;
  loginLimiter: RateLimiter;
  now: () => Date;
}
