# Deploying Dayline: Render (API) + Neon (Postgres) + Vercel (frontend)

All three have free tiers. The API runs as **one** Render free web service: no Celery
worker, no Redis, no paid add-ons.

- Periodic jobs (overdue sweep every 60 s, demo purge every hour) run inside the API
  process (`CELERY_ENABLED=false`). Each also runs once at startup, so a service that was
  asleep catches up as soon as it wakes.
- Sessions are stored in Postgres (no `REDIS_URL`), and WebSocket updates are broadcast
  in-process.
- Migrations run on every start (`alembic upgrade head`).

## 1. Database: Neon

1. Sign in at <https://neon.tech> and create a project (any region close to your Render
   region), e.g. `dayline`.
2. In the project dashboard open **Connect**, pick the default branch and database, and
   copy the connection string. It looks like:

   ```
   postgresql://<user>:<password>@ep-<id>.<region>.aws.neon.tech/<db>?sslmode=require
   ```

   Keep `?sslmode=require`. A `postgres://` prefix also works (the app normalises it).

## 2. API: Render Blueprint

1. Push this repository to GitHub (branch `master`).
2. In Render: **New > Blueprint**, connect the repository, branch `master`. Render reads
   `render.yaml` at the repo root and proposes one free web service, `dayline-api`
   (root directory `backend`, Python 3.13).
3. Fill in the variables marked "sync: false":

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The Neon connection string from step 1 |
   | `FRONTEND_ORIGIN` | Leave a placeholder for now, e.g. `https://example.vercel.app`; set the real one in step 4 |
   | `FRONTEND_APP_URL` | Same placeholder; set in step 4 |

   These are preset by the Blueprint: `DEMO_MODE_ENABLED=true`, `CELERY_ENABLED=false`,
   `ENVIRONMENT=production`, `API_ROOT_PATH=/` (API at the service root),
   `PYTHON_VERSION=3.13.2`, and a generated `DEMO_IP_SALT`.

4. **Apply**. The first deploy installs dependencies, runs `alembic upgrade head` against
   Neon, then starts `uvicorn` on `$PORT` with `--proxy-headers` (so the demo's per-IP
   limit sees real visitor addresses).

### Verify the API

Replace `<service>` with your Render service name.

```bash
curl https://<service>.onrender.com/health
# {"status":200,"message":"ok","data":{"status":"healthy","db":true}}

curl -X POST https://<service>.onrender.com/demo -H 'Content-Type: application/json' -d '{}'
# {"status":200,"message":"Demo workspace ready","data":{"token":"...","userData":{...},"demo":{...}}}
```

In the Render logs you should see `Scheduled job overdue_sweep ran: ...` and
`Scheduled job demo_purge ran: ...` shortly after each start.

## 3. Frontend: Vercel

1. In Vercel: **Add New > Project**, import the same repository.
2. **Root Directory:** `frontend`. Framework preset: Vite (build `npm run build`, output `dist`).
3. Environment variables:

   | Variable | Value |
   |---|---|
   | `VITE_APP_BASE_URL` | `https://<service>.onrender.com` |
   | `VITE_APP_ENV` | `PROD` |
   | `VITE_DEMO_ENABLED` | `true` |
   | `VITE_GITHUB_URL` | Your repository URL, e.g. `https://github.com/<you>/<repo>` |

4. Client-side routes (`/app`, `/tasks/<id>`, ...) are served by `frontend/vercel.json`,
   which rewrites every path to `index.html`. Static files such as `/sw.js` are served first.
5. Deploy and note the URL, e.g. `https://dayline-alpha-ten.vercel.app`.

## 4. Point the API at the frontend

Back in Render, open `dayline-api` > **Environment** and set:

- `FRONTEND_ORIGIN` = `https://dayline-alpha-ten.vercel.app` (CORS; comma-separate if you add a custom domain)
- `FRONTEND_APP_URL` = `https://dayline-alpha-ten.vercel.app` (links in notifications)

Save; Render redeploys. Then open the Vercel URL, click **Try the demo**, and you should
land on `/app` in a fresh demo workspace.

## Cold starts

Render's free web service sleeps after 15 minutes without traffic. The next request wakes
it, which takes roughly 30 to 60 seconds. The login and landing pages handle this: after
2.5 seconds the **Try the demo** button switches to "Waking the server..." with a short
explanation, and the request completes once the service is up. The periodic jobs simply
pause while the service sleeps and run immediately on wake.

## Notes

- Neon's free tier also suspends compute when idle; the first query after a pause adds a
  second or so. The API's connection pool pre-pings and recycles connections, so dead
  pooled connections after either side sleeps are replaced transparently.
- Demo workspaces expire after `DEMO_TTL_HOURS` (default 24). Limits:
  `DEMO_MAX_PER_IP_PER_HOUR` (default 5) and `DEMO_MAX_LIVE_WORKSPACES` (default 100).
  Add any of these in Render only if you want to change the defaults.
- Email, Slack, web-push, Gemini and SSO stay off until their variables are set (see
  `backend/.env.example`).
- To run with Celery and Redis instead (e.g. docker-compose), set `CELERY_ENABLED=true`
  and `REDIS_URL` (or `REDIS_HOST`); the in-process scheduler then stays off.
