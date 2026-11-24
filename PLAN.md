# ReachInbox Email Scheduler: Build Plan for Claude Code

> Drop this file in the repo root (or merge the "Rules" section into `CLAUDE.md`). Work milestone by milestone. Do not start a milestone until the previous one's verification passes.

---

## 0. Rules for Claude Code (read first)

1. **Test-first and iterative.** For each milestone: write the failing test (or curl check) → implement → run it → commit. Small commits, one per milestone step.
2. **Verify with curl before building UI.** Every backend endpoint must be proven with `curl` before any frontend code calls it.
3. **No cron, ever.** No `node-cron`, `agenda`, `crontab`, `setInterval`-as-scheduler. All timing = BullMQ delayed jobs. (A one-off startup reconciliation function is fine; it is not a scheduler.)
4. **DB is the source of truth. Redis is the execution layer.** Anything in Redis must be rebuildable from Postgres.
5. **Idempotency is non-negotiable.** One email row = one BullMQ job (`jobId = email.id`) = at most one SMTP send.
6. **Everything configurable lives in `.env`** (concurrency, min delay, hourly limit). Nothing hardcoded. Keep `.env.example` current.
7. **Keep it simple and readable.** The reviewers read the code for plagiarism and structure. Write it in your own style, no copy-pasted tutorials, clear folder structure, comments only where the *why* is non-obvious.
8. **Do not invent the Figma design.** Ask the user for the Figma export/screenshots, or use the Figma MCP connector if available.

---

## 1. What the assignment actually requires (checklist)

### Backend (TypeScript + Express)
- [ ] API to accept schedule requests; store in **Postgres/MySQL**
- [ ] **BullMQ delayed jobs** on **Redis** (no cron)
- [ ] Send via **Ethereal SMTP**, **multiple senders**
- [ ] **Elasticsearch**: index sent/scheduled emails, searchable
- [ ] **Live BullMQ dashboard** (bull-board)
- [ ] **Persistence**: restart → future emails still send on time, no duplicates, no restart-from-scratch
- [ ] **Worker concurrency**, configurable
- [ ] **Min delay between sends** (documented in README)
- [ ] **Hourly rate limit** (global or per-sender, configurable), Redis-backed, safe across multiple workers; over-limit jobs are **rescheduled to next hour window, never dropped**, order preserved as much as possible
- [ ] **Slack OAuth** ("Connect Slack") → token stored per user → **real Slack message** when a sender hits its hourly limit; no crash if not connected; works after later connecting without redeploy
- [ ] Defined behaviour for **1000+ emails at the same time**
- [ ] **Idempotency**

### Frontend (React/Next + Tailwind + TS)
- [ ] Real **Google OAuth** login → dashboard; header shows name, email, avatar; logout
- [ ] Tabs: **Scheduled Emails**, **Sent Emails**; **Compose New Email** button
- [ ] Compose: subject, body, **CSV/text upload** (show detected email count), start time, delay between emails, hourly limit, Schedule button
- [ ] Tables with **loading** + **empty** states, error toasts
- [ ] "Connect Slack" button
- [ ] Matches Figma; reusable components; typed API responses

### Submission
- [ ] Private repo, access to `Mitrajit` and `Yadav036`
- [ ] README (run steps, Ethereal setup, env vars, architecture, feature map, assumptions/trade-offs)
- [ ] ≤5 min demo video (schedule → dashboards → restart scenario → rate limit under load)
- [ ] Submission form filled

### Gaps in the assignment text (flag to user, don't guess silently)
- The Figma link is not included in the document. The user must supply it.
- The "View scheduled emails" bullet is cut off; the Scheduled/Sent tabs cover it.
- Slack needs a real Slack app (client id/secret, redirect URL). For local OAuth, Slack needs an **https** redirect URL, so plan on **ngrok / cloudflared**. Google OAuth works with `http://localhost`.

---

## 2. Tech decisions

| Concern | Choice | Why |
|---|---|---|
| Monorepo | `/backend`, `/frontend`, root `docker-compose.yml` | Simple, matches guidelines |
| Backend | Node 20, TypeScript, Express, `zod` validation | Required stack |
| DB | **PostgreSQL** + **Prisma** (migrations + typed client) | Required relational DB |
| Queue | **BullMQ** + Redis 7 with `appendonly yes` | Required; AOF makes jobs survive Redis restarts |
| SMTP | `nodemailer` + Ethereal (`createTestAccount`) | Required |
| Search | **Elasticsearch 8** (single node, security off for local) + `@elastic/elasticsearch` | Required |
| Dashboard | `@bull-board/express` at `/admin/queues` (basic auth) | Required |
| Auth | `passport-google-oauth20` + signed httpOnly cookie session (JWT) | Real Google OAuth |
| Slack | Slack OAuth v2 (`chat:write` + `incoming-webhook`, or `chat:write` + `conversations.open`) | Real OAuth + live message |
| Tests | `vitest` + `supertest`; Testcontainers optional, otherwise docker-compose test services | Test-first |
| Frontend | **Vite + React + TS + Tailwind + React Router + TanStack Query** | Fast, typed, simple |
| CSV parsing | `papaparse` in browser (count preview) AND re-validate on server | Never trust the client count |

---

## 3. Repo layout

```
reachinbox-scheduler/
├─ docker-compose.yml          # postgres, redis (AOF), elasticsearch
├─ README.md
├─ PLAN.md
├─ backend/
│  ├─ prisma/schema.prisma
│  ├─ src/
│  │  ├─ config/env.ts         # zod-parsed env, single source of config
│  │  ├─ db/prisma.ts
│  │  ├─ redis/connection.ts   # shared ioredis, maxRetriesPerRequest: null for BullMQ
│  │  ├─ queue/
│  │  │  ├─ emailQueue.ts      # Queue definition + enqueue helper
│  │  │  ├─ emailWorker.ts     # Worker (concurrency, limiter, process fn)
│  │  │  └─ reconcile.ts       # startup: DB → Redis re-sync
│  │  ├─ rateLimit/
│  │  │  ├─ hourlyLimiter.ts   # Lua atomic check+incr, nextWindow calc
│  │  │  └─ senderGap.ts       # per-sender min delay (optional)
│  │  ├─ services/
│  │  │  ├─ scheduleService.ts
│  │  │  ├─ mailer.ts          # nodemailer transport pool per sender
│  │  │  ├─ senderService.ts   # create/load Ethereal accounts
│  │  │  ├─ searchService.ts   # ES index + query
│  │  │  └─ slackService.ts    # OAuth + notify
│  │  ├─ routes/               # auth, schedule, emails, search, slack, health
│  │  ├─ middleware/           # requireAuth, errorHandler, validate
│  │  ├─ server.ts             # API process
│  │  └─ worker.ts             # separate worker process entry
│  └─ test/
└─ frontend/
   └─ src/{api,components/ui,features/{auth,compose,emails,slack},pages,types,hooks}
```

Run **API and worker as separate processes** (`npm run dev:api`, `npm run dev:worker`). This lets you demo "kill the API/worker, restart, emails still send," and it proves multi-worker safety.

---

## 4. Data model (Prisma)

```
User        id, googleId (unique), email, name, avatarUrl, createdAt
Sender      id, email, smtpHost, smtpPort, smtpUser, smtpPass, label, createdAt   // Ethereal accounts, shared pool
Campaign    id, userId, subject, body, startTime, delayBetweenMs, hourlyLimit, totalCount, createdAt
Email       id, campaignId, userId, toEmail, subject, body, senderId,
            scheduledAt, status (SCHEDULED | PROCESSING | SENT | FAILED),
            sentAt, messageId, previewUrl, attempts, errorMessage, createdAt
            UNIQUE(campaignId, toEmail)           // dedupe leads within a campaign
            INDEX(userId, status, scheduledAt)
SlackConnection  id, userId (unique), teamId, teamName, botToken (encrypt), channelId / webhookUrl, createdAt
```

Status transitions are **atomic**: `UPDATE Email SET status='PROCESSING' WHERE id=$1 AND status='SCHEDULED' RETURNING *`. If 0 rows → another worker has it or it is done → skip.

---

## 5. Core design

### 5.1 Scheduling (POST /api/schedule)
1. Validate (zod): subject, body, `startTime`, `delayBetweenMs`, `hourlyLimit`, `leads[]` (emails).
2. Server-side: normalise, lowercase, dedupe, validate each address.
3. In one DB transaction: create `Campaign` + all `Email` rows. Assign each email a `senderId` **round-robin** across the sender pool.
4. Compute each email's `scheduledAt`: `startTime + i * delayBetweenMs`, **then pre-pack into hourly windows per sender** (if a sender already has `hourlyLimit` emails in a window, push `scheduledAt` to the next window start). Pre-packing keeps order and means most emails never need runtime rescheduling.
5. Enqueue in bulk (`queue.addBulk`) with `jobId: email.id`, `delay: max(0, scheduledAt - now)`. `attempts: 3`, exponential backoff, `removeOnComplete` with age cap, `removeOnFail: false`.
6. Index each email in Elasticsearch (status `scheduled`).
7. Return `{campaignId, count}` quickly. For 1000+ leads, chunk the `addBulk` (e.g., 500 at a time).

### 5.2 Worker process function
```
process(job):
  1. atomic claim in DB (SCHEDULED → PROCESSING). If not claimed: return (idempotent no-op).
  2. hourly limit check for this sender (Lua, atomic). If over:
       - compute nextWindowStart + small ordered offset
       - set DB status back to SCHEDULED with new scheduledAt
       - fire Slack notification (deduped once per sender per window)
       - job.moveToDelayed(newTimestamp, token); throw new DelayedError()   // NOT a failure, NOT dropped
  3. send via nodemailer using the sender's transport
  4. on success: DB → SENT (sentAt, messageId, previewUrl), update ES
  5. on error: DB attempts++; if retries exhausted → FAILED + ES update; else rethrow for BullMQ retry
```
If a worker crashes between SMTP send and the DB update, BullMQ's stalled-job recovery would re-run it. Mitigation: before sending, check `messageId`/`sentAt`; after sending, write status in a `finally`-style guarded update; and use a deterministic `Message-ID` header derived from `email.id` so a duplicate is at least detectable. Document this window honestly in the README (at-least-once delivery + idempotency guard = effectively once).

### 5.3 Concurrency and min delay
- `WORKER_CONCURRENCY` env (default 5) → `new Worker(..., { concurrency })`.
- `MIN_DELAY_BETWEEN_SENDS_MS` env (default 2000) → BullMQ `limiter: { max: 1, duration: MIN_DELAY_MS }`. This is global across all workers because BullMQ limiter state lives in Redis.
- Document exactly the values chosen in the README.
- Note for README: the per-campaign `delayBetweenMs` from the UI is applied when computing `scheduledAt`; the env value is the global provider-throttle floor.

### 5.4 Hourly rate limit (Redis, multi-worker safe)
- Key: `rl:{senderId}:{YYYYMMDDHH}` (UTC hour window), TTL ~2h.
- Single **Lua script**: `INCR` the key; if result > limit then `DECR` and return `0 + ttl`, else return `1`. Atomic, no race between workers.
- Limit = `min(campaign.hourlyLimit, MAX_EMAILS_PER_HOUR_PER_SENDER)`; both configurable. Also support optional global cap `MAX_EMAILS_PER_HOUR`.
- Over limit → reschedule to next window start + offset by `scheduledAt` order (e.g., add `rank * 50ms`) so earlier emails stay earlier. Never fail, never drop.

### 5.5 Persistence and restart
- Redis runs with AOF (`--appendonly yes`) and a volume. BullMQ delayed jobs survive.
- **Startup reconciliation** (`reconcile.ts`, runs once when the worker boots): select Emails in `SCHEDULED` (and stale `PROCESSING` older than X minutes) → for each, `queue.getJob(email.id)`; if missing, re-add with the correct remaining delay. This covers a wiped Redis. Not a cron, it runs once on boot.
- Because `jobId = email.id`, re-adding an existing job is a no-op: no duplicates.

### 5.6 Behaviour under load (1000+ at the same time)
Document in README and demonstrate with a small config (e.g., hourly limit 5, delay 2s, 20 emails):
- All 1000 rows + jobs are created; nothing is sent in a burst because of the pre-packing, the global limiter, and the concurrency cap.
- The first N per sender per hour go out; the remainder roll into subsequent hour windows in order.
- Slack gets one message per sender per window, not one per job.

### 5.7 Elasticsearch
- Index `emails`: `id, userId, toEmail, subject, body, status, scheduledAt, sentAt, senderEmail`.
- Index on create, update on every status change (fire-and-forget with error logging; DB stays authoritative).
- `GET /api/search?q=&status=&page=` scoped by `userId`.
- Add a `reindex` script (`npm run reindex`) that rebuilds ES from Postgres.

### 5.8 Slack
- `GET /api/slack/connect` → redirect to Slack authorize URL (state = signed userId).
- `GET /api/slack/callback` → exchange code, store token + channel/webhook in `SlackConnection`.
- `DELETE /api/slack/disconnect` removes it. `GET /api/slack/status` for the UI.
- `notifyRateLimit(userId, senderEmail, limit, resumeAt)`: look up connection; **none → return silently**; else post a message. Wrap in try/catch so a Slack failure never breaks the worker. Dedupe with `SET NX EX` on `slack:{senderId}:{window}`.
- Because it is looked up at notify time, connecting later works without a redeploy.

### 5.9 Auth
- `GET /api/auth/google` → Google → `/api/auth/google/callback` → upsert User → set httpOnly cookie → redirect to `FRONTEND_URL/dashboard`.
- `GET /api/auth/me`, `POST /api/auth/logout`. All `/api/*` except auth require the cookie.
- CORS with `credentials: true`, cookie `sameSite: 'lax'`.

### 5.10 Bull Board
- Mounted at `/admin/queues`, protected by basic auth from env (`BULL_BOARD_USER`/`PASS`), plus a link from the dashboard.

---

## 6. API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/google`, `/api/auth/google/callback` | Login |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/schedule` | Create campaign + emails + jobs |
| GET | `/api/emails?status=scheduled\|sent&page=` | Table data (sent includes `failed`) |
| GET | `/api/search?q=` | ES search |
| GET | `/api/slack/connect`, `/callback`, `/status` · DELETE `/disconnect` | Slack |
| GET | `/api/senders` | List sender pool (debug/UI optional) |
| GET | `/health` | Redis/DB/ES health |

---

## 7. Milestones (each ends with a verification step)

### M1. Scaffold and infra
- Monorepo, TS configs, ESLint/Prettier, `docker-compose.yml` (Postgres, Redis AOF, Elasticsearch), `.env.example`, zod env loader.
- ✅ Verify: `docker compose up -d`; `curl localhost:3000/health` shows DB/Redis/ES ok.

### M2. DB and Ethereal senders
- Prisma schema + migration. `senderService` creates N (default 3) Ethereal accounts on first boot, saved to DB.
- ✅ Verify: test that sender pool has N rows; a script sends one test mail and prints the preview URL.

### M3. Queue + worker, basic send
- `emailQueue`, `emailWorker`, separate `worker.ts`. Atomic claim + send + status update.
- ✅ Verify (test-first): enqueue an email with `delay: 5000`; assert it is SENT after ~5s; enqueue the same `jobId` twice; assert one send.

### M4. Schedule API
- `POST /api/schedule` with zod, transactional create, round-robin sender, `scheduledAt` calc, `addBulk`.
- ✅ Verify: curl with 5 leads → rows in DB, 5 delayed jobs, sends at expected times.

### M5. Rate limiting, delay, concurrency
- Lua hourly limiter, BullMQ limiter, concurrency env, pre-packing, reschedule via `moveToDelayed` + `DelayedError`.
- ✅ Verify: vitest with `HOURLY_LIMIT=3`, send 8 → 3 sent now, 5 rescheduled to next window with order kept, none failed or dropped. Run **two worker processes** simultaneously and assert the counter never exceeds the limit.

### M6. Persistence and reconciliation
- `reconcile.ts` on worker boot.
- ✅ Verify: schedule emails 2 minutes out → kill API + worker → restart → they still send once. Then `FLUSHALL` Redis → restart worker → reconcile restores jobs. Assert no duplicates.

### M7. Bull Board + Elasticsearch
- Mount bull-board with auth. ES index/update/search + reindex script.
- ✅ Verify: `/admin/queues` shows live jobs; `curl /api/search?q=subject-word` returns the doc and its status flips to `sent`.

### M8. Google OAuth + `/api/emails`
- Passport flow, cookie session, `requireAuth`, list endpoints with pagination, user scoping.
- ✅ Verify: manual login in the browser; `curl` with cookie returns only that user's emails; unauthenticated returns 401.

### M9. Slack OAuth + notification
- Slack app, ngrok https URL, connect/callback/disconnect/status, `notifyRateLimit` with dedupe.
- ✅ Verify: not connected → rate-limit hit logs and continues (no crash); connect → trigger limit → **real Slack message arrives**; disconnect/reconnect works. Record this for the demo.

### M10. Frontend foundation
- Vite + Tailwind, router, typed API client (`credentials: 'include'`), TanStack Query, auth guard, login page, header with name/email/avatar/logout. Get Figma assets first.
- ✅ Verify: Google login redirects to the dashboard and the header shows real user data.

### M11. Dashboard, tables, compose
- Reusable UI kit (`Button`, `Input`, `Modal`, `Table`, `Tabs`, `Spinner`, `EmptyState`, `Toast`). Scheduled/Sent tables with loading, empty, and error states. Compose modal: subject, body, CSV/TXT upload (papaparse → email count preview, invalid/duplicate counts), start time, delay, hourly limit. "Connect Slack" button + status.
- ✅ Verify: schedule 5 emails from the UI → they appear in Scheduled → move to Sent with status; Slack connect flow works from the UI.

### M12. Polish, README, demo
- Match Figma pixel details. README (see section 8). Seed/demo script for the load scenario. Record the video. Grant repo access, fill the form.

---

## 8. README must contain
1. Prerequisites and how to run: `docker compose up -d`, `npm i`, `prisma migrate`, `dev:api`, `dev:worker`, frontend.
2. **Ethereal setup** (auto-created on first boot; where credentials are stored; how to open preview URLs).
3. Full **env var table** (Google, Slack, Redis, DB, ES, `WORKER_CONCURRENCY`, `MIN_DELAY_BETWEEN_SENDS_MS`, `MAX_EMAILS_PER_HOUR_PER_SENDER`, bull-board creds).
4. **Architecture**: scheduling flow, persistence on restart, rate-limit algorithm (Lua counter, window math, reschedule), concurrency + delay values, idempotency (jobId + atomic claim), 1000+ email behaviour. Include a diagram.
5. **Feature map**: Backend and Frontend items, each ticked.
6. **Assumptions and trade-offs**: at-least-once vs exactly-once window, UTC hour windows (fixed vs sliding), Ethereal shared sender pool, ES is eventually consistent, tokens encrypted at rest, etc.

## 9. Demo video script (≤5 min)
1. (0:30) Login with Google, dashboard header.
2. (1:00) Compose with a CSV, show detected count, schedule.
3. (0:45) Scheduled tab → Sent tab, Bull Board live, ES search.
4. (1:15) Restart: schedule emails 1–2 min out, kill API + worker, restart, show them still sending once.
5. (1:00) Rate limit: low hourly limit, many emails, show delayed to the next window + Slack message arriving live.
6. (0:30) Quick README / architecture walkthrough.

## 10. Common pitfalls to avoid
- BullMQ needs `maxRetriesPerRequest: null` on the ioredis connection.
- `moveToDelayed` must be followed by `throw new DelayedError()`, otherwise the job completes.
- Never use `Date.now()` hour math in local time; use UTC windows consistently.
- Don't use the in-memory counter anywhere in rate limiting.
- Don't enqueue 1000+ jobs in a single request handler without chunking.
- Slack redirect URL must be https (use ngrok); Google redirect must match exactly.
- Do not commit `.env`, Ethereal credentials, or Slack/Google secrets.
- Do not ship a stack with placeholder or dummy UI. Everything on the dashboard must hit the real API.