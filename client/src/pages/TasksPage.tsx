import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { TaskEditor } from '../components/TaskEditor';
import { useSession, useToast } from '../context';
import { formatDateTime } from '../tz';
import type { Category, Task } from '../types';

interface Filters {
  search: string;
  status: string;
  priority: string;
  categoryId: string;
  sort: string;
  dir: string;
  archived: boolean;
}

const DEFAULTS: Filters = { search: '', status: '', priority: '', categoryId: '', sort: 'due', dir: 'asc', archived: false };

export function TasksPage({ openTaskId, onOpened }: { openTaskId?: number | null; onOpened?: () => void }) {
  const { user } = useSession();
  const { toast, toastError } = useToast();
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listTasks({
        search: filters.search,
        status: filters.status,
        priority: filters.priority,
        categoryId: filters.categoryId === 'none' ? undefined : filters.categoryId,
        uncategorized: filters.categoryId === 'none' ? 'true' : undefined,
        sort: filters.sort,
        dir: filters.dir,
        archived: filters.archived ? 'true' : 'false',
        pageSize: 200,
      });
      setTasks(res.items);
      setTotal(res.total);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  }, [filters, toastError]);

  const loadCategories = useCallback(() => {
    api.categories().then((r) => setCategories(r.items)).catch(toastError);
  }, [toastError]);

  useEffect(() => void load(), [load]);
  useEffect(loadCategories, [loadCategories]);
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === search ? f : { ...f, search })), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (openTaskId) {
      setEditing(openTaskId);
      onOpened?.();
    }
  }, [openTaskId, onOpened]);

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast('success', success);
      await load();
    } catch (e) {
      toastError(e);
    }
  };

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const now = Date.now();

  return (
    <section>
      <div className="row between wrap">
        <h1>{filters.archived ? 'Archived tasks' : 'Tasks'}</h1>
        {!filters.archived && (
          <button className="primary" onClick={() => setEditing('new')}>
            + New task
          </button>
        )}
      </div>

      <div className="toolbar card">
        <input aria-label="Search tasks" type="search" placeholder="Search title, description, category, subtasks" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
        </select>
        <select aria-label="Filter by priority" value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select aria-label="Filter by category" value={filters.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">Any category</option>
          <option value="none">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Sort by" value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
          <option value="due">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="status">Sort: status</option>
          <option value="category">Sort: category</option>
        </select>
        <button type="button" onClick={() => set('dir', filters.dir === 'asc' ? 'desc' : 'asc')} aria-label={`Sort direction: ${filters.dir === 'asc' ? 'ascending' : 'descending'}`}>
          {filters.dir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        <label className="inline">
          <input type="checkbox" checked={filters.archived} onChange={(e) => set('archived', e.target.checked)} />
          Archived
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="muted empty">{filters.search || filters.status || filters.priority || filters.categoryId ? 'No tasks match these filters.' : filters.archived ? 'No archived tasks.' : 'No tasks yet. Create your first task.'}</p>
      ) : (
        <ul className="plain tasklist">
          {tasks.map((t) => {
            const overdue = t.status === 'pending' && !t.archivedAt && t.dueAt !== null && Date.parse(t.dueAt) < now;
            const subDone = t.subtasks.filter((s) => s.status === 'completed').length;
            const itemsDone = t.checklist.filter((i) => i.done).length;
            return (
              <li key={t.id} className={`card task ${t.status === 'completed' ? 'is-done' : ''}`}>
                <input
                  type="checkbox"
                  aria-label={`Mark "${t.title}" ${t.status === 'completed' ? 'pending' : 'completed'}`}
                  checked={t.status === 'completed'}
                  disabled={!!t.archivedAt}
                  onChange={() => act(() => api.updateTask(t.id, { status: t.status === 'completed' ? 'pending' : 'completed' }))}
                />
                <div className="task-main">
                  <button type="button" className="link" onClick={() => setEditing(t.id)}>
                    <span className={t.status === 'completed' ? 'done' : ''}>{t.title}</span>
                  </button>
                  <div className="meta">
                    <span className={`badge p-${t.priority}`}>{t.priority}</span>
                    {t.categoryName && <span className="badge">{t.categoryName}</span>}
                    {t.dueAt && <span className={overdue ? 'overdue' : 'muted'}>{overdue ? 'Overdue · ' : 'Due '}{formatDateTime(t.dueAt, user.timeZone)}</span>}
                    {t.recurrence && <span className="badge">repeats {t.recurrence}</span>}
                    {t.subtasks.length > 0 && <span className="muted">subtasks {subDone}/{t.subtasks.length}</span>}
                    {t.checklist.length > 0 && <span className="muted">checklist {itemsDone}/{t.checklist.length}</span>}
                    {t.reminders.some((r) => r.status === 'pending') && <span className="muted">🔔</span>}
                  </div>
                </div>
                <div className="row actions">
                  {!t.archivedAt && <button onClick={() => setEditing(t.id)}>Edit</button>}
                  {!t.archivedAt && t.status === 'completed' && <button onClick={() => act(() => api.archiveTask(t.id), 'Task archived')}>Archive</button>}
                  {t.archivedAt && <button onClick={() => act(() => api.restoreTask(t.id), 'Task restored')}>Restore</button>}
                  <button
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Permanently delete "${t.title}"? This also deletes its subtasks, checklist and reminders and cannot be undone.`)) {
                        void act(() => api.deleteTask(t.id), 'Task deleted');
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && total > tasks.length && <p className="muted small">Showing {tasks.length} of {total} tasks. Refine the filters to see the rest.</p>}

      {editing !== null && (
        <TaskEditor
          taskId={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
          onCategoriesChanged={loadCategories}
        />
      )}
    </section>
  );
}
