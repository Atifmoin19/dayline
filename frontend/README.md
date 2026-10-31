# TaskBoard — Frontend

React + TypeScript frontend for TaskBoard, a role-based task scheduling / time-tracking app.
Live day-timeline with per-developer work sessions, Jira-style task detail view, org chart,
and real-time updates over WebSocket.

See `../docs/plan.md` and `../docs/pending.md` for the full feature
inventory and open work.

## Tech stack

- React 19 + TypeScript, Vite 5
- Chakra UI v2 + Emotion
- Redux Toolkit + RTK Query (custom axios base query), redux-persist (sessionStorage)
- react-router-dom v7, served under the `/` base path
- Vitest + React Testing Library

## Setup

```bash
npm install
```

The API base URL and environment tag come from env vars. Copy the example and adjust:

```bash
cp .env.example .env.local   # gitignored; sets VITE_APP_BASE_URL, VITE_APP_ENV, VITE_BUSINESS_TZ
npm run dev                  # http://localhost:5173/
```

## Build

```bash
npm run build         # production build (uses the default mode's env)
npm run build:dev     # build with mode "dev"
```

Output goes to `dist/`. The app is served under the `/` base path
(`vite.config.ts`'s `base`, and the router's `basename`) — this is the actual deployed URL
route, not just a display name, so don't change it without updating the reverse-proxy/deploy
config that routes to it.

## Tests & linting

```bash
npm run lint       # eslint, 0 errors and 0 warnings expected
npm run typecheck  # tsc -b over tsconfig.app.json + tsconfig.node.json
npm test           # vitest
npm run test:watch
```

## Environment variables

| Var                 | Used for                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_APP_BASE_URL` | API base URL the axios client talks to                                                                                                |
| `VITE_APP_ENV`      | Tags the redux-persist storage key per environment                                                                                    |
| `VITE_BUSINESS_TZ`  | Timeline timezone (defaults to `Asia/Kolkata` if unset) — not currently set in `.env.dev`/`.env.localback`, so both use the default    |

## Project layout

- `src/Pages/` — route-level screens (dashboard, login, profile, organization, reports, SuperAdmin pages)
- `src/Components/Timeline/` — the core timeline view, task creation/detail modals, assignee picker
- `src/Services/user.api.ts` — all RTK Query endpoints
- `src/app/` — Redux store, slices, typed hooks
- `src/Utils/` — scheduler logic, org-tree visibility, priority/role helpers, avatar colors
- `src/Contexts/TaskDetailContext.tsx` — app-wide "open task detail" modal/page plumbing
- `public/sw.js` — service worker for web-push notifications
