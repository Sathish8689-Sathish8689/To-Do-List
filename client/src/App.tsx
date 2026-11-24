import { useCallback, useEffect, useState } from 'react';
import { api, setCsrfToken, setUnauthenticatedHandler } from './api';
import { NotificationBell } from './components/NotificationBell';
import { SessionProvider, useToast } from './context';
import { CalendarPage } from './pages/CalendarPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { TasksPage } from './pages/TasksPage';
import type { User, View } from './types';

type Route = 'tasks' | 'calendar' | 'dashboard' | 'settings';

const VIEW_TO_ROUTE: Record<View, Route> = { list: 'tasks', calendar: 'calendar', dashboard: 'dashboard' };
const NAV: { route: Route; label: string }[] = [
  { route: 'tasks', label: 'Tasks' },
  { route: 'calendar', label: 'Calendar' },
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'settings', label: 'Settings' },
];

const readRoute = (): Route | null => {
  const r = window.location.hash.replace('#/', '');
  return NAV.some((n) => n.route === r) ? (r as Route) : null;
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null);
      toast('info', 'Your session has ended. Please sign in again.');
    });
    api
      .me()
      .then((res) => {
        setCsrfToken(res.csrfToken);
        setUser(res.user);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [toast]);

  useEffect(() => {
    const root = document.documentElement;
    if (user && user.theme !== 'system') root.dataset.theme = user.theme;
    else delete root.dataset.theme;
  }, [user]);

  if (checking) return <p className="muted center">Loading…</p>;
  if (!user) {
    return (
      <LoginPage
        onLogin={(u) => {
          window.location.hash = `#/${VIEW_TO_ROUTE[u.defaultView]}`;
          setUser(u);
        }}
      />
    );
  }
  return (
    <SessionProvider value={{ user, setUser }}>
      <Shell user={user} onLogout={() => setUser(null)} />
    </SessionProvider>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [route, setRoute] = useState<Route>(readRoute() ?? VIEW_TO_ROUTE[user.defaultView]);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const { toastError } = useToast();

  useEffect(() => {
    const onHash = () => setRoute(readRoute() ?? route);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);

  const go = (r: Route) => {
    window.location.hash = `#/${r}`;
    setRoute(r);
  };
  const clearOpen = useCallback(() => setOpenTaskId(null), []);

  return (
    <>
      <header className="topbar">
        <strong className="brand">To Do List</strong>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? 'page' : undefined} onClick={() => setRoute(n.route)}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="row">
          <NotificationBell
            onOpenTask={(id) => {
              go('tasks');
              setOpenTaskId(id);
            }}
          />
          <button
            onClick={async () => {
              try {
                await api.logout();
              } catch (e) {
                toastError(e);
              }
              setCsrfToken('');
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="container">
        {route === 'tasks' && <TasksPage openTaskId={openTaskId} onOpened={clearOpen} />}
        {route === 'calendar' && <CalendarPage />}
        {route === 'dashboard' && <DashboardPage />}
        {route === 'settings' && <ProfilePage />}
      </main>
    </>
  );
}
