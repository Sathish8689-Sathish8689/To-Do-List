import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../context';
import type { DashboardCounts } from '../types';

export function DashboardPage() {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const { toastError } = useToast();

  useEffect(() => {
    api.dashboard().then(setCounts).catch(toastError);
  }, [toastError]);

  if (!counts) return <p className="muted">Loading…</p>;
  const cards: { label: string; value: number; cls: string; note?: string }[] = [
    { label: 'Pending', value: counts.pending, cls: '' },
    { label: 'Completed', value: counts.completed, cls: 'ok', note: `includes ${counts.archived} archived` },
    { label: 'Overdue', value: counts.overdue, cls: 'bad' },
  ];
  return (
    <section>
      <h1>Dashboard</h1>
      <div className="cards">
        {cards.map((c) => (
          <div key={c.label} className={`card stat ${c.cls}`}>
            <div className="stat-value">{c.value}</div>
            <div>{c.label}</div>
            {c.note && <div className="muted small">{c.note}</div>}
          </div>
        ))}
      </div>
      <p className="muted small">Counts cover top-level tasks. Overdue means pending, not archived, and past its due time.</p>
    </section>
  );
}
