import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../context';
import type { AppNotification } from '../types';

export function NotificationBell({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications();
      if (seen.current) {
        for (const n of res.items) if (!n.readAt && !seen.current.has(n.id)) toast('info', n.title);
      }
      seen.current = new Set(res.items.map((n) => n.id));
      setItems(res.items);
      setUnread(res.unreadCount);
    } catch {
      // Polling failures are silent; the next poll retries.
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="bell">
      <button onClick={() => { setOpen((o) => !o); if (!open) void load(); }} aria-expanded={open} aria-label={`Notifications, ${unread} unread`}>
        🔔{unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown card" role="dialog" aria-label="Notifications">
          <div className="row between">
            <strong>Notifications</strong>
            <button disabled={unread === 0} onClick={() => api.markAllRead().then(load)}>
              Mark all read
            </button>
          </div>
          {items.length === 0 && <p className="muted">No notifications.</p>}
          <ul className="plain">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? 'read' : 'unread'}>
                <button
                  className="link block"
                  onClick={async () => {
                    if (!n.readAt) await api.markRead(n.id).catch(() => {});
                    setOpen(false);
                    if (n.taskId) onOpenTask(n.taskId);
                    void load();
                  }}
                >
                  <strong>{n.title}</strong>
                  <div className="small">{n.body}</div>
                  <div className="muted small">{new Date(n.createdAt).toLocaleString()}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
