import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../errors.js';
import { asyncHandler, currentUser, parse, requireAuth } from '../http.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  COOKIE_NAME,
  createSession,
  destroySession,
  destroyOtherSessions,
  type UserRow,
} from './sessions.js';
import { publicUser } from './user.js';

const loginSchema = z.object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(256) });

// Compared against when the email is unknown so response time does not reveal valid accounts.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { email, password } = parse(loginSchema, req.body);
      const ipKey = `ip:${req.ip ?? 'unknown'}`;
      const accountKey = `account:${email.toLowerCase()}`;
      const keys = [ipKey, accountKey];
      const now = ctx.now();
      if (ctx.loginLimiter.isBlocked(keys, now.getTime())) {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Try again later.');
      }
      const user = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as
        | UserRow
        | undefined;
      const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok) {
        ctx.loginLimiter.recordFailure(keys, now.getTime());
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
      }
      ctx.loginLimiter.reset(accountKey);
      const session = createSession(ctx.db, user.id, ctx.config.sessionTtlHours, now);
      res.cookie(COOKIE_NAME, session.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: ctx.config.secureCookies,
        maxAge: ctx.config.sessionTtlHours * 3_600_000,
        path: '/',
      });
      res.json({ user: publicUser(user), csrfToken: session.csrfToken });
    }),
  );

  router.post(
    '/logout',
    auth,
    asyncHandler((_req, res) => {
      destroySession(ctx.db, res.locals.sessionToken as string);
      res.clearCookie(COOKIE_NAME, { path: '/' });
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    auth,
    asyncHandler((_req, res) => {
      res.json({ user: publicUser(currentUser(res)), csrfToken: res.locals.csrfToken });
    }),
  );

  return router;
}

export async function changePassword(
  ctx: AppContext,
  user: UserRow,
  sessionToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new ApiError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  ctx.db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(await hashPassword(newPassword), user.id);
  destroyOtherSessions(ctx.db, user.id, sessionToken);
}
