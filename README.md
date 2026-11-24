# To Do List

Single-user, responsive web application for creating, organizing, prioritizing, scheduling and tracking tasks (Jira KAN-2).

- **API:** Node.js 24 + Express 5 + TypeScript, SQLite via the built-in `node:sqlite` module (no native build step).
- **Client:** React + Vite + TypeScript, responsive layout, light/dark theme.
- **Worker:** reminder dispatcher and retry loop. It runs inside the API process by default; set `WORKER_MODE=external` and run `npm run worker` to run it separately.

## Setup

```powershell
npm install
Copy-Item .env.example .env   # then set ADMIN_PASSWORD (min 8 characters) and ADMIN_EMAIL
npm run dev                   # API on :3000, client on http://localhost:5173
```

The single account is created from `ADMIN_*` on first start when the database has no users. Change the password afterwards under **Settings**. There is no self-registration and no password-reset flow (see Known limitations).

Production: `npm run build`, then `npm start` (the API serves `client/dist` on `PORT`). Terminate TLS in front of it and set `SECURE_COOKIES=true` and `TRUST_PROXY=true`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (watch) and client dev server |
| `npm test` | Server unit and API integration tests (Vitest, in-memory SQLite) |
| `npm run typecheck` | TypeScript checks for server and client |
| `npm run build` | Compile the server and build the client |
| `npm run worker` | Standalone reminder worker |

## Behavior decisions implemented

| Area | Rule |
| --- | --- |
| Login | Required. One seeded account, password change, no email verification. Sessions are HttpOnly SameSite=Strict cookies; state-changing calls need the `X-CSRF-Token` header; five failed logins per account or IP block sign-in for 15 minutes. |
| Categories | One per task. Deleting a category leaves its tasks uncategorized. |
| Subtasks | One level. Shown under the parent, excluded from the task list, dashboard counts and calendar. Search matches the parent when a subtask matches. |
| Checklist | Simple text items that can be ticked. |
| Due date | Date and time, stored as a UTC instant and shown in the profile time zone. |
| Archive | Only completed top-level tasks. Archived tasks count as completed on the dashboard. |
| Overdue | Pending, not archived, due time before now. |
| Delete | Permanent, confirmed in the UI. Removes subtasks, checklist and reminders. |
| Recurrence | Daily, weekly or monthly. The next occurrence is created once when the task is completed (checklist and reminders copied). Deleting a task removes only that occurrence. Wall-clock time is kept across DST in the profile time zone; monthly repeats clamp to the last day of shorter months. |
| Reminders | Lead time 0 minutes to 30 days before the due time, on in-app, email and push. Cancelled when the task is completed, archived or loses its due date; recalculated when the due date changes; re-armed if a completed task is reopened. |
| Delivery | At-least-once with claim/lease, retries with exponential backoff (max 5 attempts per channel). Channels the user disabled in Settings are skipped. |
| Notifications | In-app feed with unread count and toasts. Created for due reminders and for newly generated recurring occurrences. They keep their text if the task is deleted. |
| SMS | Out of scope. |

## API overview

All routes are under `/api`; errors use `{ "error": { "code", "message", "details?", "requestId" } }`.

`POST /auth/login|logout`, `GET /auth/me`, `GET|PATCH /profile`, `POST /profile/password`,
`GET|POST /categories`, `PATCH|DELETE /categories/:id`,
`GET|POST /tasks`, `GET|PATCH|DELETE /tasks/:id`, `POST /tasks/:id/archive|restore|checklist|reminders`,
`PATCH|DELETE /checklist/:id`, `DELETE /reminders/:id`, `GET /dashboard`,
`GET /notifications`, `POST /notifications/read-all|:id/read`, `GET /health`.

`GET /tasks` query: `search`, `status`, `priority`, `categoryId`, `uncategorized`, `dueFrom` (inclusive), `dueTo` (exclusive), `archived`, `sort` (`status|priority|category|due`), `dir`, `page`, `pageSize`.

## Known limitations

- Email and push use console placeholder adapters; no provider is configured (D-12). Browser Web Push subscriptions, the service worker and the PWA manifest are not implemented.
- No password recovery. If the password is lost, reset it by deleting the user row and restarting with `ADMIN_PASSWORD` set, or edit the database directly.
- Search uses `LIKE` matching, not a full-text index.
- Time-zone changes recompute reminders, but because due dates are stored as instants, existing due times do not move.
- No browser end-to-end tests, no device/browser compatibility matrix (D-13), and no backup procedure (D-14).
- The login limiter is in memory and per process.
