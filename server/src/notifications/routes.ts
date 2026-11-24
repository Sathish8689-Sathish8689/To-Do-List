import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { asyncHandler, currentUser, idParam, parse, requireAuth } from '../http.js';

const querySchema = z.object({
  unread: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

interface NotificationRow {
  id: number;
  task_id: number | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export function notificationsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx));

  router.get(
    '/notifications',
    asyncHandler((req, res) => {
      const q = parse(querySchema, req.query);
      const userId = currentUser(res).id;
      const rows = ctx.db
        .prepare(
          `SELECT id, task_id, title, body, read_at, created_at FROM notifications
           WHERE user_id = ? ${q.unread === 'true' ? 'AND read_at IS NULL' : ''}
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(userId, q.limit) as unknown as NotificationRow[];
      const { n } = ctx.db
        .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
        .get(userId) as unknown as { n: number };
      res.json({
        unreadCount: n,
        items: rows.map((r) => ({
          id: r.id,
          taskId: r.task_id,
          title: r.title,
          body: r.body,
          readAt: r.read_at,
          createdAt: r.created_at,
        })),
      });
    }),
  );

  router.post(
    '/notifications/read-all',
    asyncHandler((_req, res) => {
      ctx.db
        .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
        .run(ctx.now().toISOString(), currentUser(res).id);
      res.status(204).end();
    }),
  );

  router.post(
    '/notifications/:id/read',
    asyncHandler((req, res) => {
      const r = ctx.db
        .prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?')
        .run(ctx.now().toISOString(), idParam(req), currentUser(res).id);
      if (r.changes === 0) throw notFound('Notification');
      res.status(204).end();
    }),
  );

  return router;
}
