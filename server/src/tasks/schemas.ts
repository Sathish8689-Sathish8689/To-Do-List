import { z } from 'zod';
import { CHANNELS } from '../notifications/adapters.js';
import { MAX_LEAD_MINUTES } from './reminders.js';

const isoDate = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO 8601 date-time' })
  .transform((v) => new Date(v).toISOString());

const title = z.string().trim().min(1, 'Title is required').max(200);
const description = z.string().max(5000);

export const createTaskSchema = z.object({
  title,
  description: description.default(''),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  dueAt: isoDate.nullable().default(null),
  categoryId: z.number().int().positive().nullable().default(null),
  recurrence: z.enum(['daily', 'weekly', 'monthly']).nullable().default(null),
  parentId: z.number().int().positive().nullable().default(null),
});

export const updateTaskSchema = z
  .object({
    title,
    description,
    priority: z.enum(['high', 'medium', 'low']),
    dueAt: isoDate.nullable(),
    categoryId: z.number().int().positive().nullable(),
    recurrence: z.enum(['daily', 'weekly', 'monthly']).nullable(),
    status: z.enum(['pending', 'completed']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'completed']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  uncategorized: z.enum(['true', 'false']).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  archived: z.enum(['true', 'false']).default('false'),
  sort: z.enum(['status', 'priority', 'category', 'due']).default('due'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const checklistCreateSchema = z.object({ text: z.string().trim().min(1, 'Text is required').max(300) });
export const checklistUpdateSchema = z
  .object({ text: z.string().trim().min(1).max(300), done: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const reminderCreateSchema = z.object({
  leadMinutes: z.number().int().min(0).max(MAX_LEAD_MINUTES),
  channels: z.array(z.enum(CHANNELS)).min(1, 'Select at least one channel').max(CHANNELS.length),
});

export const categorySchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(60) });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
