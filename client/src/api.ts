import type {
  AppNotification,
  Category,
  Channel,
  DashboardCounts,
  Task,
  TaskInput,
  TaskPage,
  User,
} from './types';

let csrfToken = '';
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { path: string; message: string }[] = [],
    public requestId?: string,
  ) {
    super(message);
  }
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

let onUnauthenticated: () => void = () => {};
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | { error?: { code: string; message: string; details?: { path: string; message: string }[]; requestId?: string } }
    | null;
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && path !== '/auth/login') onUnauthenticated();
    throw new ApiRequestError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Request failed', e?.details, e?.requestId);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User; csrfToken: string }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<{ user: User; csrfToken: string }>('GET', '/auth/me'),

  listTasks: (params: Record<string, string | number | undefined>) =>
    request<TaskPage>('GET', `/tasks${qs(params)}`),
  getTask: (id: number) => request<Task>('GET', `/tasks/${id}`),
  createTask: (input: Partial<TaskInput> & { title: string; parentId?: number }) =>
    request<Task>('POST', '/tasks', input),
  updateTask: (id: number, patch: Partial<TaskInput> & { status?: Task['status'] }) =>
    request<Task>('PATCH', `/tasks/${id}`, patch),
  deleteTask: (id: number) => request<void>('DELETE', `/tasks/${id}`),
  archiveTask: (id: number) => request<Task>('POST', `/tasks/${id}/archive`),
  restoreTask: (id: number) => request<Task>('POST', `/tasks/${id}/restore`),

  addChecklist: (taskId: number, text: string) => request<Task>('POST', `/tasks/${taskId}/checklist`, { text }),
  updateChecklist: (id: number, patch: { text?: string; done?: boolean }) =>
    request<Task>('PATCH', `/checklist/${id}`, patch),
  deleteChecklist: (id: number) => request<Task>('DELETE', `/checklist/${id}`),

  addReminder: (taskId: number, leadMinutes: number, channels: Channel[]) =>
    request<Task>('POST', `/tasks/${taskId}/reminders`, { leadMinutes, channels }),
  deleteReminder: (id: number) => request<Task>('DELETE', `/reminders/${id}`),

  categories: () => request<{ items: Category[] }>('GET', '/categories'),
  createCategory: (name: string) => request<Category>('POST', '/categories', { name }),
  renameCategory: (id: number, name: string) => request<Category>('PATCH', `/categories/${id}`, { name }),
  deleteCategory: (id: number) => request<void>('DELETE', `/categories/${id}`),

  dashboard: () => request<DashboardCounts>('GET', '/dashboard'),

  notifications: () => request<{ unreadCount: number; items: AppNotification[] }>('GET', '/notifications?limit=30'),
  markRead: (id: number) => request<void>('POST', `/notifications/${id}/read`),
  markAllRead: () => request<void>('POST', '/notifications/read-all'),

  updateProfile: (patch: Partial<Omit<User, 'id' | 'notifications'>> & { notifications?: Partial<User['notifications']> }) =>
    request<User>('PATCH', '/profile', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/profile/password', { currentPassword, newPassword }),
};
