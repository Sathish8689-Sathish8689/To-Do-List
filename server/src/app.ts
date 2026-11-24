import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { authRouter } from './auth/routes.js';
import { createLoginLimiter } from './auth/rateLimit.js';
import type { AppContext } from './context.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { ApiError } from './errors.js';
import { errorHandler, requestContext } from './http.js';
import type { Logger } from './logger.js';
import { createAdapters, type Channel, type ChannelAdapter } from './notifications/adapters.js';
import { notificationsRouter } from './notifications/routes.js';
import { profileRouter } from './profile.js';
import { categoriesRouter } from './tasks/categories.js';
import { tasksRouter } from './tasks/routes.js';
import { readHeartbeat } from './worker/loop.js';

export interface AppOptions {
  db: DB;
  config: Config;
  logger: Logger;
  adapters?: Record<Channel, ChannelAdapter>;
  now?: () => Date;
}

export function createContext(opts: AppOptions): AppContext {
  return {
    db: opts.db,
    config: opts.config,
    logger: opts.logger,
    adapters: opts.adapters ?? createAdapters(opts.db, opts.logger),
    loginLimiter: createLoginLimiter(),
    now: opts.now ?? (() => new Date()),
  };
}

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.config.trustProxy);

  app.use(requestContext(ctx));
  app.use(
    helmet({
      hsts: ctx.config.secureCookies,
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'upgrade-insecure-requests': ctx.config.secureCookies ? [] : null,
        },
      },
    }),
  );
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', workerHeartbeat: readHeartbeat(ctx.db) });
  });
  app.use('/api/auth', authRouter(ctx));
  app.use('/api', profileRouter(ctx));
  app.use('/api', categoriesRouter(ctx));
  app.use('/api', notificationsRouter(ctx));
  app.use('/api', tasksRouter(ctx));
  app.use('/api', () => {
    throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found');
  });

  const staticDir = resolve(ctx.config.staticDir);
  if (existsSync(resolve(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(resolve(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler(ctx));
  return app;
}
