import { Router } from 'express';
import type { AppContext } from '../context.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { asyncHandler, currentUser, idParam, parse, requireAuth } from '../http.js';
import { categorySchema } from './schemas.js';

interface CategoryRow {
  id: number;
  name: string;
}

export function categoriesRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx));

  const list = (userId: number) =>
    ctx.db.prepare('SELECT id, name FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as unknown as CategoryRow[];

  const write = (fn: () => CategoryRow): CategoryRow => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        throw conflict('CATEGORY_EXISTS', 'A category with that name already exists');
      }
      throw err;
    }
  };

  router.get(
    '/categories',
    asyncHandler((_req, res) => {
      res.json({ items: list(currentUser(res).id) });
    }),
  );

  router.post(
    '/categories',
    asyncHandler((req, res) => {
      const { name } = parse(categorySchema, req.body);
      const userId = currentUser(res).id;
      const created = write(() => {
        const r = ctx.db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(userId, name);
        return { id: Number(r.lastInsertRowid), name };
      });
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/categories/:id',
    asyncHandler((req, res) => {
      const { name } = parse(categorySchema, req.body);
      const id = idParam(req);
      const userId = currentUser(res).id;
      const updated = write(() => {
        const r = ctx.db.prepare('UPDATE categories SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
        if (r.changes === 0) throw notFound('Category');
        return { id, name };
      });
      res.json(updated);
    }),
  );

  // Tasks in a deleted category become uncategorized (FK ON DELETE SET NULL).
  router.delete(
    '/categories/:id',
    asyncHandler((req, res) => {
      const r = ctx.db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(idParam(req), currentUser(res).id);
      if (r.changes === 0) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
      res.status(204).end();
    }),
  );

  return router;
}
