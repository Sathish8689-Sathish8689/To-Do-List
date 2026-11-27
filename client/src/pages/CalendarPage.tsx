import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { TaskEditor } from '../components/TaskEditor';
import { useSession, useToast } from '../context';
import { dateKey, formatTime, monthRange, todayKey } from '../tz';
import type { Category, Task } from '../types';

const WEEKDAYS = [
  { short: 'Sun', full: 'Sunday' },
  { short: 'Mon', full: 'Monday' },
  { short: 'Tue', full: 'Tuesday' },
  { short: 'Wed', full: 'Wednesday' },
  { short: 'Thu', full: 'Thursday' },
  { short: 'Fri', full: 'Friday' },
  { short: 'Sat', full: 'Saturday' },
];
const pad = (n: number) => String(n).padStart(2, '0');

export function CalendarPage() {
  const { user } = useSession();
  const { toastError } = useToast();
  const today = todayKey(user.timeZone);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { from, to } = monthRange(year, month, user.timeZone);
    try {
      const res = await api.listTasks({ dueFrom: from, dueTo: to, sort: 'due', pageSize: 200 });
      setTasks(res.items);
    } catch (e) {
      toastError(e);
    }
  }, [year, month, user.timeZone, toastError]);

  const loadCategories = useCallback(() => {
    api.categories().then((r) => setCategories(r.items)).catch(toastError);
  }, [toastError]);

  useEffect(() => void load(), [load]);
  useEffect(loadCategories, [loadCategories]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const k = dateKey(t.dueAt, user.timeZone);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [tasks, user.timeZone]);

  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, (i + 1) * 7));

  const shift = (delta: number) => {
    const idx = year * 12 + (month - 1) + delta;
    setYear(Math.floor(idx / 12));
    setMonth((idx % 12) + 1);
  };
  const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <section>
      <div className="row between wrap">
        <h1>Calendar</h1>
        <div className="row">
          <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <strong aria-live="polite">{label}</strong>
          <button onClick={() => shift(1)} aria-label="Next month">›</button>
          <button
            onClick={() => {
              setYear(Number(today.slice(0, 4)));
              setMonth(Number(today.slice(5, 7)));
            }}
          >
            Today
          </button>
        </div>
      </div>
      <table className="calendar" aria-label={label}>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day.short} className="cal-head" scope="col" aria-label={day.full}>
                {day.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, dayIndex) => {
                const key = day ? `${year}-${pad(month)}-${pad(day)}` : '';
                const items = day ? byDay.get(key) ?? [] : [];
                return (
                  <td key={`${weekIndex}-${dayIndex}`} className={`cal-cell ${day ? '' : 'empty'} ${key === today ? 'today' : ''}`}>
                    <div className="cal-cell-content">
                      {day && <div className="cal-day"><time dateTime={key}>{day}</time></div>}
                      {items.map((t) => (
                        <button key={t.id} className={`cal-task p-${t.priority} ${t.status === 'completed' ? 'done' : ''}`} onClick={() => setEditing(t.id)} title={t.title}>
                          {formatTime(t.dueAt!, user.timeZone)} {t.title}
                        </button>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Shows top-level, non-archived tasks that have a due date in this month.</p>
      {editing !== null && (
        <TaskEditor taskId={editing} categories={categories} onClose={() => setEditing(null)} onChanged={() => void load()} onCategoriesChanged={loadCategories} />
      )}
    </section>
  );
}
