import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { createLogger } from '../logger.js';
import { createAdapters } from '../notifications/adapters.js';
import { startWorker } from './loop.js';

const config = loadConfig();
const logger = createLogger();
const db = openDb(config.dbPath);
const stop = startWorker({ db, adapters: createAdapters(db, logger), logger }, config.workerIntervalMs);
logger.info('worker_started', { intervalMs: config.workerIntervalMs });

const shutdown = () => {
  stop();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
