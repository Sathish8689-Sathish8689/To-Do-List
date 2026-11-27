import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { api } from './api';
import { ToastProvider } from './context';
import type { User } from './types';

vi.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <h2>Dashboard route</h2>,
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    setCsrfToken: vi.fn(),
    setUnauthenticatedHandler: vi.fn(),
    api: {
      ...actual.api,
      categories: vi.fn(),
      me: vi.fn(),
      updateProfile: vi.fn(),
    },
  };
});

const user: User = {
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  theme: 'system',
  timeZone: 'UTC',
  defaultView: 'list',
  notifications: { inApp: true, email: false, push: false },
};

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

describe('appearance preference flow', () => {
  beforeEach(() => {
    window.location.hash = '#/settings';
    delete document.documentElement.dataset.theme;
    vi.mocked(api.me).mockResolvedValue({ user, csrfToken: 'csrf' });
    vi.mocked(api.categories).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps selection as a draft until save succeeds and applies it across routes', async () => {
    const savedUser = { ...user, theme: 'dark' as const };
    let resolveSave!: (saved: User) => void;
    vi.mocked(api.updateProfile).mockImplementation(
      () => new Promise<User>((resolve) => { resolveSave = resolve; }),
    );

    const userActions = userEvent.setup();
    renderApp();

    const darkOption = await screen.findByRole('radio', { name: /dark/i });
    await userActions.click(darkOption);
    expect(darkOption instanceof HTMLInputElement && darkOption.checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(api.updateProfile).not.toHaveBeenCalled();

    await userActions.click(screen.getByRole('button', { name: 'Save appearance' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ theme: 'dark' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();

    resolveSave(savedUser);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

    await userActions.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard route' })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('retains the applied theme and draft after failure and retries only on user action', async () => {
    const failed = { ...user, theme: 'light' as const };
    const savedDark = { ...user, theme: 'dark' as const };
    vi.mocked(api.me).mockResolvedValue({ user: failed, csrfToken: 'csrf' });
    vi.mocked(api.updateProfile)
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce(savedDark);

    const userActions = userEvent.setup();
    renderApp();

    const darkOption = await screen.findByRole('radio', { name: /dark/i });
    await userActions.click(darkOption);
    expect(document.documentElement.dataset.theme).toBe('light');

    await userActions.click(screen.getByRole('button', { name: 'Save appearance' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't confirm/i);
    expect(darkOption instanceof HTMLInputElement && darkOption.checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(api.updateProfile).toHaveBeenCalledTimes(1);

    const retry = screen.getByRole('button', { name: 'Retry saving appearance' });
    await userActions.click(retry);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(api.updateProfile).toHaveBeenCalledTimes(2);
  });
});
