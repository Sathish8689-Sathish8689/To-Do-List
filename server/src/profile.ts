import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { changePassword } from './auth/routes.js';
import { isValidTimeZone, publicUser } from './auth/user.js';
import type { UserRow } from './auth/sessions.js';
import { ApiError, conflict } from './errors.js';
import { asyncHandler, currentUser, parse, requireAuth } from './http.js';
import { syncUserReminders } from './tasks/reminders.js';
import { tx } from './db.js';

const profileSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    theme: z.enum(['light', 'dark', 'system']),
    timeZone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
    defaultView: z.enum(['list', 'calendar', 'dashboard']),
    notifications: z
      .object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() })
      .partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export function profileRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx));

  router.get(
    '/profile',
    asyncHandler((_req, res) => {
      res.json(publicUser(currentUser(res)));
    }),
  );

  router.patch(
    '/profile',
    asyncHandler((req, res) => {
      const patch = parse(profileSchema, req.body);
      const user = currentUser(res);
      const n = patch.notifications ?? {};
      try {
        tx(ctx.db, () => {
          ctx.db
            .prepare(
              `UPDATE users SET name = ?, email = ?, theme = ?, time_zone = ?, default_view = ?,
                 notify_in_app = ?, notify_email = ?, notify_push = ? WHERE id = ?`,
            )
            .run(
              patch.name ?? user.name,
              patch.email ?? user.email,
              patch.theme ?? user.theme,
              patch.timeZone ?? user.time_zone,
              patch.defaultView ?? user.default_view,
              n.inApp === undefined ? user.notify_in_app : n.inApp ? 1 : 0,
              n.email === undefined ? user.notify_email : n.email ? 1 : 0,
              n.push === undefined ? user.notify_push : n.push ? 1 : 0,
              user.id,
            );
          if (patch.timeZone && patch.timeZone !== user.time_zone) syncUserReminders(ctx.db, user.id, ctx.now());
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE/i.test(err.message)) {
          throw conflict('EMAIL_IN_USE', 'That email address is already in use');
        }
        throw err;
      }
      const fresh = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
      res.json(publicUser(fresh));
    }),
  );

  router.post(
    '/profile/password',
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = parse(passwordSchema, req.body);
      if (currentPassword === newPassword) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The new password must differ from the current password');
      }
      await changePassword(ctx, currentUser(res), res.locals.sessionToken as string, currentPassword, newPassword);
      res.status(204).end();
    }),
  );

  return router;
}
