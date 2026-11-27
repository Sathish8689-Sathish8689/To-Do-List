import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { useSession, useToast } from '../context';
import { timeZones } from '../tz';
import type { Category, Theme, User, View } from '../types';

export function ProfilePage() {
  const { user, setUser } = useSession();
  const { toast, toastError } = useToast();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [theme, setTheme] = useState<Theme>(user.theme);
  const [appearanceError, setAppearanceError] = useState('');
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [timeZone, setTimeZone] = useState(user.timeZone);
  const [defaultView, setDefaultView] = useState<View>(user.defaultView);
  const [notif, setNotif] = useState(user.notifications);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [zones] = useState(timeZones);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const loadCategories = () => api.categories().then((r) => setCategories(r.items)).catch(toastError);
  useEffect(() => void loadCategories(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      const updated: User = await api.updateProfile({ name, email, timeZone, defaultView, notifications: notif });
      setUser(updated);
      toast('success', 'Profile and preferences saved');
    } catch (err) {
      if (err instanceof ApiRequestError && err.details.length) setErrors(err.fieldErrors());
      else toastError(err);
    }
  }

  async function saveAppearance(e: FormEvent) {
    e.preventDefault();
    setAppearanceSaving(true);
    setAppearanceError('');
    try {
      const updated: User = await api.updateProfile({ theme });
      setUser(updated);
      toast('success', 'Appearance saved');
    } catch {
      setAppearanceError(
        "We couldn't confirm that your appearance preference was saved. The appearance currently active in this app remains in place, and your selected option is kept. Retry to try again.",
      );
    } finally {
      setAppearanceSaving(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwError('');
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      toast('success', 'Password changed. Other sessions were signed out.');
    } catch (err) {
      if (err instanceof ApiRequestError) setPwError(err.details[0]?.message ?? err.message);
      else toastError(err);
    }
  }

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await loadCategories();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <section className="stack">
      <h1>Settings</h1>

      <form className="card stack" onSubmit={saveAppearance}>
        <h2>Application Preferences</h2>
        <fieldset>
          <legend>Appearance</legend>
          <div className="theme-options">
            <div className="theme-choice">
              <label className="inline" htmlFor="theme-system">
                <input
                  id="theme-system"
                  type="radio"
                  name="theme"
                  value="system"
                  checked={theme === 'system'}
                  aria-describedby="theme-system-description"
                  onChange={() => setTheme('system')}
                />
                System Default
              </label>
              <p className="muted small" id="theme-system-description">Follows this device's current appearance.</p>
            </div>
            <div className="theme-choice">
              <label className="inline" htmlFor="theme-light">
                <input
                  id="theme-light"
                  type="radio"
                  name="theme"
                  value="light"
                  checked={theme === 'light'}
                  aria-describedby="theme-light-description"
                  onChange={() => setTheme('light')}
                />
                Light
              </label>
              <p className="muted small" id="theme-light-description">Always uses Light Mode, regardless of device settings.</p>
            </div>
            <div className="theme-choice">
              <label className="inline" htmlFor="theme-dark">
                <input
                  id="theme-dark"
                  type="radio"
                  name="theme"
                  value="dark"
                  checked={theme === 'dark'}
                  aria-describedby="theme-dark-description"
                  onChange={() => setTheme('dark')}
                />
                Dark
              </label>
              <p className="muted small" id="theme-dark-description">Always uses Dark Mode, regardless of device settings.</p>
            </div>
          </div>
        </fieldset>
        {appearanceError && <p className="field-error" role="alert">{appearanceError}</p>}
        <button className="primary" type="submit" disabled={appearanceSaving}>
          {appearanceSaving ? 'Saving…' : appearanceError ? 'Retry saving appearance' : 'Save appearance'}
        </button>
      </form>

      <form className="card stack" onSubmit={saveProfile}>
        <h2>Profile</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </label>
        <h2>Preferences</h2>
        <div className="grid2">
          <label>
            Default view
            <select value={defaultView} onChange={(e) => setDefaultView(e.target.value as View)}>
              <option value="list">Task list</option>
              <option value="calendar">Calendar</option>
              <option value="dashboard">Dashboard</option>
            </select>
          </label>
        </div>
        <label>
          Time zone
          <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {(zones.includes(timeZone) ? zones : [timeZone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {errors.timeZone && <span className="field-error">{errors.timeZone}</span>}
        </label>
        <fieldset>
          <legend>Reminder channels</legend>
          <label className="inline"><input type="checkbox" checked={notif.inApp} onChange={(e) => setNotif({ ...notif, inApp: e.target.checked })} /> In-app</label>
          <label className="inline"><input type="checkbox" checked={notif.email} onChange={(e) => setNotif({ ...notif, email: e.target.checked })} /> Email</label>
          <label className="inline"><input type="checkbox" checked={notif.push} onChange={(e) => setNotif({ ...notif, push: e.target.checked })} /> Push</label>
          <p className="muted small">Email and push use a placeholder provider until real providers are configured.</p>
        </fieldset>
        <button className="primary">Save</button>
      </form>

      <form className="card stack" onSubmit={savePassword}>
        <h2>Change password</h2>
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          New password (min 8 characters)
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </label>
        {pwError && <p className="field-error" role="alert">{pwError}</p>}
        <button className="primary">Change password</button>
      </form>

      <div className="card stack">
        <h2>Categories</h2>
        <ul className="plain">
          {categories.map((c) => (
            <li key={c.id} className="row between">
              <span>{c.name}</span>
              <span className="row">
                <button
                  onClick={() => {
                    const n = window.prompt('Rename category', c.name);
                    if (n && n.trim() && n !== c.name) void guard(() => api.renameCategory(c.id, n));
                  }}
                >
                  Rename
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm(`Delete category "${c.name}"? Its tasks become uncategorized.`)) void guard(() => api.deleteCategory(c.id));
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
          {categories.length === 0 && <li className="muted">No categories yet.</li>}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCategory.trim()) void guard(async () => { await api.createCategory(newCategory); setNewCategory(''); });
          }}
        >
          <input aria-label="New category name" placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          <button>Add</button>
        </form>
      </div>
    </section>
  );
}
