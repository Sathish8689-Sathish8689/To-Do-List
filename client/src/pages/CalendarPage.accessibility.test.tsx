import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';
import { api } from '../api';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  listTasks: vi.fn(),
  categories: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listTasks: mocks.listTasks,
      categories: mocks.categories,
    },
  };
});

vi.mock('../context', () => ({
  useSession: () => ({
    user: {
      id: 1,
      name: 'Test User',
      email: 'test@example.com',
      theme: 'system',
      timeZone: 'UTC',
      defaultView: 'calendar',
      notifications: { inApp: true, email: false, push: false },
    },
  }),
  useToast: () => ({ toastError: mocks.toastError }),
}));

describe('CalendarPage accessibility', () => {
  beforeEach(() => {
    vi.mocked(api.listTasks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    vi.mocked(api.categories).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses native table semantics for weekdays and calendar weeks', async () => {
    render(<CalendarPage />);

    const table = await screen.findByRole('table');
    expect(table.getAttribute('aria-label')).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7);

    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole('cell')).toHaveLength(7);
    }
  });
});
