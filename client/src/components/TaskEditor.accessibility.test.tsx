import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskEditor } from './TaskEditor';

const toastMocks = vi.hoisted(() => ({
  toast: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../context', () => ({
  useSession: () => ({ user: { timeZone: 'UTC' } }),
  useToast: () => toastMocks,
}));

function TestEditor() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open task editor</button>
      {open && (
        <TaskEditor
          taskId={null}
          categories={[]}
          onClose={() => setOpen(false)}
          onChanged={() => {}}
          onCategoriesChanged={() => {}}
        />
      )}
    </>
  );
}

describe('TaskEditor accessibility', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('isolates background content and contains keyboard focus until close', async () => {
    const user = userEvent.setup();
    render(<TestEditor />);

    const opener = screen.getByRole('button', { name: 'Open task editor' });
    await user.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const title = within(dialog).getByLabelText('Title');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const last = within(dialog).getByRole('button', { name: 'Create task' });

    expect(document.activeElement).toBe(title);
    expect(opener.parentElement?.hasAttribute('inert')).toBe(true);

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);

    close.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener.parentElement?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
