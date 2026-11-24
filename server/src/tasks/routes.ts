import { Router } from 'express';
import type { AppContext } from '../context.js';
import { asyncHandler, currentUser, idParam, parse, requireAuth } from '../http.js';
import {
  checklistCreateSchema,
  checklistUpdateSchema,
  createTaskSchema,
  listQuerySchema,
  reminderCreateSchema,
  updateTaskSchema,
} from './schemas.js';
import * as svc from './service.js';

export function tasksRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx));
  const uid = (res: Parameters<typeof currentUser>[0]) => currentUser(res).id;

  router.get(
    '/tasks',
    asyncHandler((req, res) => {
      res.json(svc.listTasks(ctx.db, uid(res), parse(listQuerySchema, req.query)));
    }),
  );

  router.post(
    '/tasks',
    asyncHandler((req, res) => {
      res.status(201).json(svc.createTask(ctx.db, uid(res), parse(createTaskSchema, req.body), ctx.now()));
    }),
  );

  router.get(
    '/tasks/:id',
    asyncHandler((req, res) => {
      res.json(svc.getTask(ctx.db, uid(res), idParam(req)));
    }),
  );

  router.patch(
    '/tasks/:id',
    asyncHandler((req, res) => {
      res.json(svc.updateTask(ctx.db, uid(res), idParam(req), parse(updateTaskSchema, req.body), ctx.now()));
    }),
  );

  router.delete(
    '/tasks/:id',
    asyncHandler((req, res) => {
      svc.deleteTask(ctx.db, uid(res), idParam(req));
      res.status(204).end();
    }),
  );

  router.post(
    '/tasks/:id/archive',
    asyncHandler((req, res) => {
      res.json(svc.archiveTask(ctx.db, uid(res), idParam(req), ctx.now()));
    }),
  );

  router.post(
    '/tasks/:id/restore',
    asyncHandler((req, res) => {
      res.json(svc.restoreTask(ctx.db, uid(res), idParam(req), ctx.now()));
    }),
  );

  router.post(
    '/tasks/:id/checklist',
    asyncHandler((req, res) => {
      const { text } = parse(checklistCreateSchema, req.body);
      res.status(201).json(svc.addChecklistItem(ctx.db, uid(res), idParam(req), text));
    }),
  );

  router.patch(
    '/checklist/:id',
    asyncHandler((req, res) => {
      res.json(svc.updateChecklistItem(ctx.db, uid(res), idParam(req), parse(checklistUpdateSchema, req.body)));
    }),
  );

  router.delete(
    '/checklist/:id',
    asyncHandler((req, res) => {
      res.json(svc.deleteChecklistItem(ctx.db, uid(res), idParam(req)));
    }),
  );

  router.post(
    '/tasks/:id/reminders',
    asyncHandler((req, res) => {
      const input = parse(reminderCreateSchema, req.body);
      res.status(201).json(svc.addReminder(ctx.db, uid(res), idParam(req), input, ctx.now()));
    }),
  );

  router.delete(
    '/reminders/:id',
    asyncHandler((req, res) => {
      res.json(svc.deleteReminder(ctx.db, uid(res), idParam(req)));
    }),
  );

  router.get(
    '/dashboard',
    asyncHandler((_req, res) => {
      res.json(svc.dashboard(ctx.db, uid(res), ctx.now()));
    }),
  );

  return router;
}
