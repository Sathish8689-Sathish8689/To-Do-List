import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ZodError } from 'zod';
import { ApiError } from './errors.js';
import type { AppContext } from './context.js';
import { COOKIE_NAME, findSession, parseCookies, type UserRow } from './auth/sessions.js';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw zodToApiError(result.error);
  return result.data;
}

function zodToApiError(err: ZodError): ApiError {
  const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  return new ApiError(400, 'VALIDATION_ERROR', 'The request contains invalid data', details);
}

export const requestContext = (ctx: AppContext): RequestHandler => (req, res, next) => {
  const requestId = randomUUID();
  const started = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;
    ctx.logger.info('request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - started) / 1e6,
    });
  });
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const requireAuth = (ctx: AppContext): RequestHandler => (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const session = token ? findSession(ctx.db, token, ctx.now()) : null;
  if (!token || !session) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue');
  if (!SAFE_METHODS.has(req.method)) {
    const sent = req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, session.csrfToken)) {
      throw new ApiError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
    }
  }
  res.locals.user = session.user;
  res.locals.csrfToken = session.csrfToken;
  res.locals.sessionToken = token;
  next();
};

export const currentUser = (res: Response): UserRow => res.locals.user as UserRow;

export const errorHandler = (ctx: AppContext): ErrorRequestHandler => (err, req, res, _next) => {
  const requestId = res.locals.requestId as string | undefined;
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    const e = zodToApiError(err);
    ({ status, code, message, details } = e);
  } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON';
  } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large';
  } else {
    ctx.logger.error('unhandled_error', {
      requestId,
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId } });
};

export function asyncHandler(fn: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
  return n;
}
