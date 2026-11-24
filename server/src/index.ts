import { createApp, createContext } from './app.js';
import { ensureSeedUser } from './auth/user.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createLogger } from './logger.js';
import { startWorker } from './worker/loop.js';

const config = loadConfig();
const logger = createLogger();
const db = openDb(config.dbPath);

if (await ensureSeedUser(db, config, new Date())) logger.info('seed_user_created');

const ctx = createContext({ db, config, logger });
const server = createApp(ctx).listen(config.port, () => logger.info('server_started', { port: config.port }));
const stopWorker = config.runWorkerInProcess
  ? startWorker({ db, adapters: ctx.adapters, logger }, config.workerIntervalMs)
  : () => {};

const shutdown = () => {
  stopWorker();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
