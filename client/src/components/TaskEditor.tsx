import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiRequestError } from '../api';
import { useSession, useToast } from '../context';
import { isoToLocalInput, localInputToIso } from '../tz';
import type { Category, Channel, Priority, Recurrence, Task } from '../types';

const LEADS: { value: number; label: string }[] = [
  { value: 0, label: 'At due time' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];
const CHANNEL_LABELS: Record<Channel, string> = { in_app: 'In-app', email: 'Email', push: 'Push' };
const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not(:disabled):not([tabindex="-1"])',
  'input:not(:disabled):not([type="hidden"]):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface Props {
  taskId: number | null;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
  onCategoriesChanged: () => void;
}

export function TaskEditor({ taskId, categories, onClose, onChanged, onCategoriesChanged }: Props) {
  const { user } = useSession();
  const { toast, toastError } = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(taskId !== null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [due, setDue] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [newItem, setNewItem] = useState('');
  const [lead, setLead] = useState(30);
  const [channels, setChannels] = useState<Channel[]>(['in_app']);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const fill = (t: Task) => {
    setTask(t);
    setTitle(t.title);
    setDescription(t.description);
    setPriority(t.priority);
    setDue(isoToLocalInput(t.dueAt, user.timeZone));
    setCategoryId(t.categoryId);
    setRecurrence(t.recurrence);
  };

  useEffect(() => {
    if (taskId === null) return;
    api
      .getTask(taskId)
      .then(fill)
      .catch((e) => {
        toastError(e);
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay,
    );
    const previousInert = background.map((element) => [element, element.hasAttribute('inert')] as const);
    background.forEach((element) => {
      element.setAttribute('inert', '');
    });

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.tabIndex >= 0,
      );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (dialog.contains(event.target as Node)) return;
      (getFocusable()[0] ?? dialog).focus();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    (titleRef.current ?? getFocusable()[0] ?? dialog).focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      previousInert.forEach(([element, inert]) => {
        if (inert) element.setAttribute('inert', '');
        else element.removeAttribute('inert');
      });
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, []);

  useEffect(() => {
    if (!loading) titleRef.current?.focus();
  }, [loading]);

  const refresh = async (id: number) => {
    fill(await api.getTask(id));
    onChanged();
  };

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toastError(e);
    }
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const dueAt = due ? localInputToIso(due, user.timeZone) : null;
    const payload = { title, description, priority, dueAt, categoryId, recurrence };
    try {
      if (task) {
        fill(await api.updateTask(task.id, payload));
        toast('success', 'Task saved');
      } else {
        fill(await api.createTask(payload));
        toast('success', 'Task created. You can now add subtasks, a checklist and reminders.');
      }
      onChanged();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 400) setErrors({ ...err.fieldErrors(), ...(err.details.length ? {} : { form: err.message }) });
      else toastError(err);
    } finally {
      setBusy(false);
    }
  }

  const addCategory = () =>
    guard(async () => {
      const name = newCategory.trim();
      if (!name) return;
      const c = await api.createCategory(name);
      setNewCategory('');
      setCategoryId(c.id);
      onCategoriesChanged();
    });

  const archived = task?.archivedAt != null;
  const isSub = task?.parentId != null;

  return createPortal(
    <div ref={overlayRef} className="overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCloseRef.current()}>
      <div ref={dialogRef} className="modal card" role="dialog" aria-modal="true" aria-labelledby="editor-title" tabIndex={-1}>
        <div className="row between">
          <h2 id="editor-title">{task ? 'Edit task' : 'New task'}</h2>
          <button type="button" onClick={() => onCloseRef.current()} aria-label="Close">
            ✕
          </button>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {archived && <p className="banner">This task is archived. Restore it from the list to edit it.</p>}
            <form className="stack" onSubmit={save}>
              <fieldset disabled={archived} className="stack">
                <label>
                  Title
                  <input ref={titleRef} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
                  {errors.title && <span className="field-error">{errors.title}</span>}
                </label>
                <label>
                  Description
                  <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <div className="grid2">
                  <label>
                    Priority
                    <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label>
                    Due ({user.timeZone})
                    <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={!!errors.dueAt} />
                    {errors.dueAt && <span className="field-error">{errors.dueAt}</span>}
                  </label>
                </div>
                {!isSub && (
                  <div className="grid2">
                    <label>
                      Category
                      <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">None</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {errors.categoryId && <span className="field-error">{errors.categoryId}</span>}
                    </label>
                    <label>
                      Repeats
                      <select value={recurrence ?? ''} onChange={(e) => setRecurrence((e.target.value || null) as Recurrence | null)}>
                        <option value="">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                  </div>
                )}
                {!isSub && (
                  <div className="row">
                    <input aria-label="New category name" placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
                    <button type="button" onClick={addCategory}>
                      Add category
                    </button>
                  </div>
                )}
                {errors.form && <p className="field-error">{errors.form}</p>}
                {recurrence && <p className="muted small">The next occurrence is created when you mark this task completed.</p>}
                <button className="primary" disabled={busy}>
                  {busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}
                </button>
              </fieldset>
            </form>

            {task && !archived && (
              <>
                {!isSub && (
                  <section className="stack">
                    <h3>Subtasks</h3>
                    <ul className="plain">
                      {task.subtasks.map((s) => (
                        <li key={s.id} className="row between">
                          <label className="inline">
                            <input
                              type="checkbox"
                              checked={s.status === 'completed'}
                              onChange={() => guard(async () => { await api.updateTask(s.id, { status: s.status === 'completed' ? 'pending' : 'completed' }); await refresh(task.id); })}
                            />
                            <span className={s.status === 'completed' ? 'done' : ''}>{s.title}</span>
                          </label>
                          <button type="button" aria-label={`Delete subtask ${s.title}`} onClick={() => guard(async () => { await api.deleteTask(s.id); await refresh(task.id); })}>
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="row">
                      <input aria-label="New subtask" placeholder="Add a subtask" value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} />
                      <button type="button" onClick={() => guard(async () => { if (!newSubtask.trim()) return; await api.createTask({ title: newSubtask, parentId: task.id }); setNewSubtask(''); await refresh(task.id); })}>
                        Add
                      </button>
                    </div>
                  </section>
                )}

                <section className="stack">
                  <h3>Checklist</h3>
                  <ul className="plain">
                    {task.checklist.map((i) => (
                      <li key={i.id} className="row between">
                        <label className="inline">
                          <input type="checkbox" checked={i.done} onChange={() => guard(async () => { fill(await api.updateChecklist(i.id, { done: !i.done })); onChanged(); })} />
                          <span className={i.done ? 'done' : ''}>{i.text}</span>
                        </label>
                        <button type="button" aria-label={`Delete checklist item ${i.text}`} onClick={() => guard(async () => { fill(await api.deleteChecklist(i.id)); onChanged(); })}>
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="row">
                    <input aria-label="New checklist item" placeholder="Add a checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                    <button type="button" onClick={() => guard(async () => { if (!newItem.trim()) return; fill(await api.addChecklist(task.id, newItem)); setNewItem(''); onChanged(); })}>
                      Add
                    </button>
                  </div>
                </section>

                <section className="stack">
                  <h3>Reminders</h3>
                  <ul className="plain">
                    {task.reminders.map((r) => (
                      <li key={r.id} className="row between">
                        <span>
                          {LEADS.find((l) => l.value === r.leadMinutes)?.label ?? `${r.leadMinutes} min before`} via {r.channels.map((c) => CHANNEL_LABELS[c]).join(', ')}{' '}
                          <span className="badge">{r.status}</span>
                        </span>
                        <button type="button" aria-label="Delete reminder" onClick={() => guard(async () => { fill(await api.deleteReminder(r.id)); onChanged(); })}>
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!task.dueAt ? (
                    <p className="muted small">Save a due date to add reminders.</p>
                  ) : (
                    <div className="stack">
                      <div className="row wrap">
                        <select aria-label="Reminder lead time" value={lead} onChange={(e) => setLead(Number(e.target.value))}>
                          {LEADS.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                        {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
                          <label key={c} className="inline">
                            <input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))} />
                            {CHANNEL_LABELS[c]}
                          </label>
                        ))}
                        <button type="button" onClick={() => guard(async () => { fill(await api.addReminder(task.id, lead, channels)); onChanged(); })}>
                          Add reminder
                        </button>
                      </div>
                      <p className="muted small">Email and push are delivered only if enabled in Settings; they currently use a placeholder provider.</p>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
