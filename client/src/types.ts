export type Priority = 'high' | 'medium' | 'low';
export type Status = 'pending' | 'completed';
export type Recurrence = 'daily' | 'weekly' | 'monthly';
export type Channel = 'in_app' | 'email' | 'push';
export type Theme = 'light' | 'dark' | 'system';
export type View = 'list' | 'calendar' | 'dashboard';

export interface User {
  id: number;
  name: string;
  email: string;
  theme: Theme;
  timeZone: string;
  defaultView: View;
  notifications: { inApp: boolean; email: boolean; push: boolean };
}

export interface Reminder {
  id: number;
  leadMinutes: number;
  channels: Channel[];
  remindAt: string;
  status: string;
}

export interface Task {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  dueAt: string | null;
  categoryId: number | null;
  categoryName: string | null;
  recurrence: Recurrence | null;
  completedAt: string | null;
  archivedAt: string | null;
  checklist: { id: number; text: string; done: boolean }[];
  reminders: Reminder[];
  subtasks: Task[];
}

export interface Category {
  id: number;
  name: string;
}

export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AppNotification {
  id: number;
  taskId: number | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardCounts {
  pending: number;
  completed: number;
  overdue: number;
  archived: number;
}

export interface TaskInput {
  title: string;
  description: string;
  priority: Priority;
  dueAt: string | null;
  categoryId: number | null;
  recurrence: Recurrence | null;
}
