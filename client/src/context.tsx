import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ApiRequestError } from './api';
import type { User } from './types';

interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface ToastApi {
  toast: (kind: Toast['kind'], message: string) => void;
  toastError: (err: unknown) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {}, toastError: () => {} });
export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const toastError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiRequestError) {
        toast('error', err.requestId ? `${err.message} (ref ${err.requestId.slice(0, 8)})` : err.message);
      } else {
        toast('error', 'Something went wrong. Please try again.');
      }
    },
    [toast],
  );

  return (
    <ToastContext.Provider value={{ toast, toastError }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface SessionState {
  user: User;
  setUser: (u: User) => void;
}

const SessionContext = createContext<SessionState | null>(null);
export const SessionProvider = SessionContext.Provider;
export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error('No session');
  return s;
}
