# ReachInbox Email Scheduler

Work in progress. The full README (architecture, env table, trade-offs) lands in M12; see [PLAN.md](PLAN.md) for the spec.

## Local ports

This stack uses non-default host ports so it can run next to other local projects. All are set in `.env`.

| Service | Host port | Container |
|---|---|---|
| API | 3001 | n/a (runs on host) |
| Postgres | 5434 | `reachinbox_postgres` |
| Redis (AOF on) | 6380 | `reachinbox_redis` |
| Elasticsearch | 9200 | `reachinbox_elasticsearch` |
| Frontend (Vite) | 5173 | n/a (runs on host) |

Compose project name is `reachinbox`; volumes are `reachinbox_pgdata`, `reachinbox_redisdata`, `reachinbox_esdata`.

## Run (current state)

```bash
cp .env.example .env          # then edit as needed
docker compose up -d          # postgres, redis, elasticsearch
cd backend && npm install     # also generates the Prisma client
npm run db:deploy             # apply migrations to the dev database
npm run dev:api               # API on http://localhost:3001 (creates the Ethereal sender pool on first boot)
curl localhost:3001/health    # 200 when DB, Redis and ES are all reachable
npm run send:test-email       # sends one mail via sender 1 and prints the Ethereal preview URL
npm run dev:worker            # separate worker process: consumes the BullMQ email queue
npm run reindex               # rebuild the Elasticsearch index from Postgres (idempotent)
npm run seed:emails -- --count 3 --delay 5000   # dev-only: insert rows directly, bypassing pre-packing
                              # (flags: --user <email> --hourly-limit <n> --senders <n>)
npm test                      # vitest; needs compose up
```

Frontend, in a second terminal (needs the API running):

```bash
cd frontend && npm install
npm run dev                   # http://localhost:5173 (log in here)
npm test                      # vitest + Testing Library (no backend needed)
npm run lint && npm run typecheck && npm run build
```

Tests use their own BullMQ key prefix (`reachinbox-test-<uuid>`) and delete every key under it afterwards, so they never touch dev jobs under `reachinbox:`.

## Schedule API (so far)

All `/api/*` routes except `/api/auth/*` need a session cookie from Google login (see *Authentication*). With curl, pass it as `-b 'reachinbox_session=<token>'`.

```bash
curl -X POST localhost:3001/api/schedule \
  -H 'Content-Type: application/json' -b 'reachinbox_session=<token>' \
  -d '{"subject":"Hi","body":"Hello","startTime":"2026-12-01T10:00:00Z",
       "delayBetweenMs":2000,"hourlyLimit":50,"leads":["a@example.com","b@example.com"]}'
```

- Leads are trimmed, lowercased, validated and deduped on the server; the response reports `received / accepted / duplicate / invalid` (client-supplied counts are ignored).
- `startTime` must include a timezone. A past `startTime` is sent as soon as possible.
- `hourlyLimit` is **per sender**: each sender sends at most this many of the campaign's emails per window (so with 3 senders and `hourlyLimit: 50`, the campaign can send up to 150 per hour).
- Leads are pre-packed into hourly windows at schedule time (see *Rate limiting* below); each email stores its lead position as `seq`.
- The campaign and all its email rows are written in one transaction; jobs are enqueued only after it commits, in `ENQUEUE_CHUNK_SIZE` batches. If Redis fails part-way, the API answers `503` with how many were queued; all rows stay `SCHEDULED` and the missing jobs are re-queued the next time a worker starts (see *Persistence and crash recovery*).
- Limits from `.env`: `MAX_LEADS_PER_CAMPAIGN`, `MAX_EMAIL_BODY_CHARS`, `ENQUEUE_CHUNK_SIZE`, `PLANNING_HORIZON_DAYS` (a plan that would end later is rejected with `400`).

## Rate limiting (M5)

**Ordering.** Every email has one total order: `(scheduledAt, seq, id)`, where `seq` is its lead position in the campaign. What is *guaranteed* is the order of assigned `scheduledAt` values (within a campaign they never decrease with `seq`, at schedule time and after any runtime reschedule). The *actual* send order is approximate when `WORKER_CONCURRENCY > 1`: jobs due close together can finish out of order because SMTP latency varies.

**Windows.** Windows are epoch-aligned: window *n* is `[n·W, (n+1)·W)` with `W = RATE_LIMIT_WINDOW_MS` (default 1h, i.e. UTC hours). Redis keys and the pre-pack SQL use the same math.

**Caps (all `0 = off`), most restrictive wins:**

| Cap | Source | Scope |
|---|---|---|
| campaign | `hourlyLimit` in the request | per campaign, **per sender**, per window |
| sender | `MAX_EMAILS_PER_HOUR_PER_SENDER` | per sender (all campaigns), per window |
| global | `MAX_EMAILS_PER_HOUR` | all senders, per window |

**1. Pre-packing at schedule time (best effort).** Inside one transaction holding a Postgres advisory lock (so concurrent schedule requests can't book the same capacity), the API counts emails already booked per sender per window across *all* campaigns, then places lead *i* at the first time ≥ previous + `delayBetweenMs` (first slot = `max(startTime, now)`) whose window has room, on the next sender in rotation that has room. The rotation starts at the least-loaded sender, so campaigns don't all start on Sender 1. When every sender is full, the rest of the campaign moves to the next window start and the spacing resumes from there. Nothing is dropped.

**2. Runtime limiter (authoritative).** Before each send the worker runs one Lua script that checks all three counters (`{prefix}:rl:cs:{campaign}:{sender}:{window}`, `rl:s:{sender}:{window}`, `rl:g:{window}`, TTL two windows) and increments them only if all pass, atomically, so any number of workers can't exceed a cap. An over-limit email does **not** count as a failed attempt and never touches SMTP: its row goes back to `SCHEDULED` with a new `scheduledAt` at the next window start + rank × `RESCHEDULE_SPACING_MS` (rank is handed out in the order jobs hit the limit, keeping earlier emails earlier), and the BullMQ job is moved there with `moveToDelayed` + `DelayedError`. A failed SMTP send refunds exactly the counter keys it took.

Pre-packing is only a best-effort plan; the runtime limiter is what enforces the caps. Sends drift from the plan because of the global min delay, SMTP latency, worker downtime and retries, so an email planned near the end of a window can land in the next one, where the runtime limiter may push it again.

**3. Global minimum delay.** `MIN_DELAY_BETWEEN_SENDS_MS` (default 2000) is a BullMQ worker limiter (`max: 1` per duration) whose state lives in Redis, so it holds across all workers. The effective gap between sends is at least `max(delayBetweenMs, MIN_DELAY_BETWEEN_SENDS_MS)` and total throughput is capped at `3600000 / MIN_DELAY_BETWEEN_SENDS_MS` per hour (1800/h at 2000 ms). Lower it for the load demo.

**Trade-offs.** Fixed windows allow a burst of up to 2× a cap around a window boundary (e.g. N at 10:59 and N at 11:00). Window keys use each worker's clock, so worker hosts need synced clocks. If Redis is wiped mid-window, that window's counters restart at 0 (M6's reconcile reseeds them from `SENT` rows). Schedule requests are serialised by the advisory lock.

## Sending pipeline (so far)

- **One row, one job, one send.** Each `Email` row is enqueued with `jobId = email.id` and a delay of `scheduledAt - now`, so adding it twice is a no-op.
- **Atomic claim.** The worker runs `UPDATE "Email" SET status='PROCESSING', attempts=attempts+1 WHERE id=$1 AND status='SCHEDULED' AND "sentAt" IS NULL RETURNING id`. A worker that gets 0 rows returns without sending, so even two jobs for the same row (e.g. on different queues) produce one send.
- **Retries.** On an SMTP error the row goes back to `SCHEDULED` (so the BullMQ retry can claim it again) with `errorMessage` set; after `EMAIL_JOB_ATTEMPTS` attempts with exponential backoff from `EMAIL_JOB_BACKOFF_MS` it becomes `FAILED`. Failed jobs are kept in Redis for inspection.
- **Deterministic Message-ID.** `<email.id@sender-domain>`, so a repeated send of the same row is recognisable.
- **Graceful shutdown.** On SIGINT/SIGTERM the worker stops taking jobs and waits for in-flight sends to finish before exiting.
- `sentAt` is when the SMTP server accepted the mail; Ethereal typically takes a few seconds per message, mostly on the first connection per sender.

Tests run against a separate `<POSTGRES_DB>_test` database on the same Postgres container; it is created and migrated automatically, so tests never touch dev data.

## Ethereal senders (so far)

On first boot the backend creates `SENDER_POOL_SIZE` (default 3) Ethereal accounts and stores them in the `Sender` table. Later boots reuse them. A Postgres advisory lock stops the API and worker from both creating a pool when they start together. Ethereal passwords are stored in plaintext: they are throwaway fake-inbox accounts. Log in at https://ethereal.email with a sender's `email`/`smtpPass` to see everything it sent, or open the preview URL printed per message.

## Persistence and crash recovery (M6)

Postgres is the source of truth; Redis only holds execution state and can be rebuilt from it.

- **Redis restarts:** Redis runs with AOF (`appendonly yes`) on a volume, so delayed jobs and limiter counters survive a Redis restart by themselves.
- **API / worker restarts:** jobs live in Redis, not in the processes, so killing either (even `kill -9`) loses nothing; a restarted worker picks the delayed jobs up on time.
- **Startup reconcile** (`src/queue/reconcile.ts`): runs **once** when a worker process boots, before it takes jobs. Never in the API, no timers or intervals. Several workers booting together are guarded by a Redis `SET NX PX` lock (`RECONCILE_LOCK_MS`), and every step is idempotent, so running it twice is harmless. It:
  1. resets **stale** `PROCESSING` rows (claimed longer ago than `STALE_PROCESSING_MS`, default 10 min) back to `SCHEDULED`. Fresh `PROCESSING` rows are never touched;
  2. **reseeds this window's rate-limit counters** from the `SENT` rows in the DB, with a Lua script that only *raises* a counter, never lowers it (same epoch window math as the limiter);
  3. walks every `SCHEDULED` row in chunks (`RECONCILE_CHUNK_SIZE`): a job in `delayed` / `waiting` / `active` is left alone; a missing job is re-added with the remaining delay (0 if past due); a `completed` or `failed` job whose row is still `SCHEDULED` is removed and re-added (otherwise its id would block the new job). `SENT` and `FAILED` rows are never re-queued.

  This covers a wiped Redis (e.g. deleting every key under the queue prefix): the worker's next boot restores every pending job from Postgres.

**The at-least-once window, honestly.** Delivery is *at-least-once with an idempotency guard*, not exactly-once:

- The atomic claim (`SCHEDULED -> PROCESSING`) means duplicate jobs, racing workers and BullMQ's stalled-job re-runs can never send a row twice while its claim is live.
- If a worker dies **after the SMTP server accepted the mail but before the row was marked `SENT`**, the row stays `PROCESSING`. Nothing re-sends it until a worker boots after `STALE_PROCESSING_MS` and resets it, and that reset **will send it again**. The duplicate carries the same deterministic `Message-ID` (`<email.id@sender-domain>`), so receivers and logs can detect it.
- If the worker dies **before** sending, the same path delivers the first and only copy, late by up to `STALE_PROCESSING_MS` (plus however long until the next worker boot).
- SMTP phases are bounded by `SMTP_TIMEOUT_MS` (default 30 s; nodemailer's own socket default is 10 min), and the env loader refuses a `STALE_PROCESSING_MS` below `3 x SMTP_TIMEOUT_MS + 30 s` (BullMQ's lock), so a slow but live send is never mistaken for a crashed one.

## Bull Board (M7)

Live BullMQ dashboard for the real `email-send` queue at **http://localhost:3001/admin/queues**, mounted in the API process behind HTTP basic auth (`BULL_BOARD_USER` / `BULL_BOARD_PASS`, compared in constant time). If either is empty the dashboard is not mounted. The `.env.example` placeholder password (`change-me`) is refused in production (not mounted) and only allowed in development with a warning in the log.

## Search (M7)

Every email is a document in the `<ES_INDEX_PREFIX>-emails` index (`_id` = email id) with an explicit, strict mapping: `id`, `userId`, `campaignId`, `status`, `toEmail`, `senderEmail` as keyword (`toEmail` also has a `.text` sub-field so partial addresses match), `subject` and `body` as text, `scheduledAt` and `sentAt` as dates. API and worker both create it at startup if missing (idempotent).

- **On create:** after the campaign transaction commits and *before* its jobs are enqueued, the new emails are bulk-indexed (`ES_BULK_CHUNK_SIZE` per request). Indexing first means a worker's status update can never reach Elasticsearch ahead of the document it updates.
- **On every status change** (`sent`, `failed`, and back to `scheduled` with the new `scheduledAt` after a rate-limit reschedule; retries stay `scheduled`) the worker upserts the full document with `doc_as_upsert`, so a document whose create was lost is recreated whole. These writes are fire-and-forget and never delay a send.
- **`GET /api/search?q=&status=&page=&pageSize=`** searches `subject`, `body` and `toEmail`; `status` (`scheduled` / `sent` / `failed`) is an exact filter. Results are **always filtered to the signed-in user**. `pageSize` is capped by `SEARCH_MAX_PAGE_SIZE` and `page x pageSize` by 10,000. Response: `{ total, page, pageSize, results }`.
- **Elasticsearch is secondary.** If it is down or slow (`ES_REQUEST_TIMEOUT_MS`), scheduling and sending carry on; each failed write logs `[search] ... failed (Postgres is unaffected; run "npm run reindex" to resync)`, and `/api/search` answers `503`. The index is eventually consistent with Postgres.
- **`npm run reindex`** rebuilds the index from Postgres in chunks (overwriting by `_id`), then walks the index and deletes documents whose row no longer exists. It is idempotent and safe to run while the app is live.

## Authentication (M8)

Real Google OAuth (`passport-google-oauth20`), no server-side sessions:

1. `GET /api/auth/google` sets a random `state` in a short-lived httpOnly cookie and redirects to Google.
2. `GET /api/auth/google/callback` checks that Google returned the same `state` (CSRF protection for the round trip; the state cookie is single-use), exchanges the code, then creates the `User` by `googleId` on first login and refreshes name, email and avatar on every login. Two simultaneous first logins for the same account are safe: the loser of the insert race re-reads the winner's row.
3. It sets `reachinbox_session`, a signed JWT (HS256, `JWT_SECRET`, lifetime `JWT_EXPIRES_IN`) in an **httpOnly, SameSite=Lax** cookie (`Secure` in production), and redirects to `FRONTEND_URL/dashboard`. Any failure redirects to `FRONTEND_URL/login?error=<code>` (`invalid_state`, `access_denied`, `oauth_failed`, `google_not_configured`). Redirect targets are fixed config, never taken from the request.

- `GET /api/auth/me` returns `{ id, name, email, avatarUrl }` or `401`. `POST /api/auth/logout` clears the cookie (`204`).
- Every other `/api/*` route requires the cookie (`401 {"error":"Not authenticated"}` otherwise); a tampered, expired or foreign-signed token, or one for a deleted user, is rejected. `/health` is public; Bull Board keeps its own basic auth.
- CORS allows only `FRONTEND_URL`, with credentials; other origins get no CORS headers. SameSite=Lax keeps the cookie off cross-site POSTs.
- Setup: create an OAuth client (type *Web application*) in Google Cloud Console and add `http://localhost:3001/api/auth/google/callback` as an *Authorized redirect URI*; put the client id and secret in `.env`. Without them the server still starts and login redirects with `google_not_configured`.

## Frontend (M10)

`frontend/`: Vite, React 19, TypeScript, Tailwind v4, React Router, TanStack Query, lucide icons. The design comes from the Figma screenshots in [`design/`](design/).

- **One origin.** The app only calls relative `/api/...` paths (`credentials: 'include'`). In dev, Vite proxies `/api` and `/admin` to `http://localhost:${API_PORT}` (read from the root `.env`). In production (M13), one origin serves both. No backend URL appears in frontend code.
- **Login.** Open `http://localhost:5173`, then click **Login with Google**. That navigates to `/api/auth/google`. After Google, the API redirects to `FRONTEND_URL/dashboard` (`FRONTEND_URL=http://localhost:5173`). `/login?error=<code>` shows a readable message. Unknown codes get a generic message and are never echoed.
- **Google callback port.** The Google callback still lands on `:3001` (`GOOGLE_CALLBACK_URL`). That is fine on localhost: cookies are not port-scoped, so the state cookie set through the `:5173` proxy reaches the callback, and the session cookie reaches the app.
- **Guard.** `/dashboard` needs `GET /api/auth/me`. A `401` from any query or mutation clears the cache and goes to `/login`. Any other failure, such as the API being down, shows "Can't reach the server" with a retry, so an outage isn't mistaken for being logged out.
- **Shell.** The Figma sidebar contains:
  - the logo;
  - the user card: avatar with a letter fallback, name, email;
  - a ⌄ menu with **Log out** (`POST /api/auth/logout`) and a *Connect Slack* placeholder;
  - Compose;
  - the Scheduled and Sent tabs.

  The tables, compose page and Slack button arrive in M11.
- **Design tokens.** They live in `frontend/src/index.css` (`@theme`). Components use token names (`bg-primary`, `text-ink-muted`, …), never raw hex values. Colours were sampled from the screenshots; sizes are estimates at a 1440px frame.

**Trade-off: email/password login is shown but disabled.** The Figma login card has email/password fields. Only Google sign-in exists, so the fields, divider and Login button are rendered **disabled** for design fidelity, with the note "Email login isn't available yet, please use Google." There is no email/password endpoint and no client-side auth logic behind them.

## Emails API (M8)

`GET /api/emails?status=scheduled|sent&page=&pageSize=` (default `scheduled`, `pageSize` capped by `LIST_MAX_PAGE_SIZE`) returns `{ total, page, pageSize, results }` for the signed-in user only. Each result: `id, toEmail, subject, scheduledAt, sentAt, status, previewUrl, bodyPreview, errorMessage`.

- `previewUrl` is set only on sent rows.
- `bodyPreview` is the body with whitespace collapsed, cut to 120 characters plus `…`. Postgres does the cut, so full bodies never leave the database for a list.
- `errorMessage` is set only on `FAILED` rows. A row that is still retrying keeps its last error internally, but the list doesn't show it.

- `scheduled`: `SCHEDULED` and `PROCESSING` rows, in send order `(scheduledAt, seq, id)`.
- `sent`: `SENT` and `FAILED` rows, newest first by `sentAt` (or `failedAt`, recorded when a row fails for good).

`GET /api/senders` returns only `{ count }`, the size of the sender pool, for the compose page. It never returns addresses or credentials.

## Slack tunnel (local dev)

**Why:** Slack only accepts an `https://` OAuth redirect URL, and `http://localhost` doesn't qualify (Google does accept localhost, which is why login needs no tunnel). A free ngrok **static domain** gives the local API a fixed public https address, so the redirect URL configured in the Slack app never changes.

**One-time setup**
1. Install the ngrok CLI (https://ngrok.com/download; on Arch `yay -S ngrok`) and run `ngrok config add-authtoken <your-token>` once. The token lives in ngrok's own config, never in this repo's `.env`.
2. Claim your free static domain at https://dashboard.ngrok.com/domains and set it in `.env`: `NGROK_DOMAIN=your-name.ngrok-free.dev`.
3. Use `https://<NGROK_DOMAIN>/api/slack/callback` as `SLACK_REDIRECT_URL` and as the Slack app's Redirect URL.

**Run it** in its own terminal, separate from the API and worker (the app never starts ngrok itself):
```bash
cd backend && npm run tunnel     # = ngrok http --url=$NGROK_DOMAIN $API_PORT
```

- It only needs to be running **during the "Connect Slack" flow**, when Slack redirects the browser back to the callback. The worker's Slack messages are *outbound* calls to Slack's API and don't use the tunnel.
- On the free plan, the first visit to the ngrok URL in a browser shows an ngrok **"You are about to visit..." warning page**; click *Visit Site* to continue to the callback. This is ngrok's interstitial, not an error.
- `npm run tunnel` exits with a clear message if `NGROK_DOMAIN` is empty or the ngrok CLI is not installed.

## Slack alerts (M9)

When one of your senders hits a rate limit, you get **one Slack DM per sender per hour window** saying which limit was hit and when sending resumes (e.g. *"Hourly limit reached for sender x@ethereal.email: this campaign's limit of 3 emails per sender per hour. The remaining emails were not dropped. They were rescheduled, and sending resumes at 2026-11-25 13:00 UTC."*).

**Set up (once):**
1. Use a **separate Slack workspace** for development (https://slack.com/get-started#/createnew), not a company one.
2. Start the tunnel (see *Slack tunnel*) and create the app at https://api.slack.com/apps -> *Create New App* -> *From a manifest*, choosing that workspace, with [`backend/slack/manifest.yml`](backend/slack/manifest.yml) (replace `YOUR-NGROK-DOMAIN`). Scopes: `chat:write` (post) and `im:write` (open a DM with the user who connected).
3. From the app's *Basic Information*, put `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` in `.env`, plus `SLACK_REDIRECT_URL=https://<NGROK_DOMAIN>/api/slack/callback`. All three or none. `ENCRYPTION_KEY` must be set too. The API logs which callback URL it expects at startup.

**Endpoints**
- `GET /api/slack/connect` (logged in): redirects to Slack's consent page. The OAuth `state` is a signed, purpose-tagged, 10-minute, **single-use** token carrying the user id, because Slack redirects to the tunnel/production host where the login cookie may not exist.
- `GET /api/slack/callback` (public, verified by `state`): exchanges the code (`oauth.v2.access`), opens a DM with the connecting user (`conversations.open`), stores the bot token **encrypted with AES-256-GCM** (`ENCRYPTION_KEY`) in `SlackConnection`, and redirects to `FRONTEND_URL/dashboard?slack=connected` (or `denied`, `invalid_state`, `error`, `not_configured`).
- `GET /api/slack/status` -> `{ available, connected, teamName?, connectedAt? }`, never the token. `DELETE /api/slack/disconnect` revokes the token at Slack (best effort) and deletes the connection.

**Behaviour**
- The worker calls the notifier on every rate-limit reschedule (fire-and-forget). It looks the connection up **at that moment**, so connecting Slack later works without a restart; with no connection it logs once per sender per window and carries on.
- Dedupe: `SET {prefix}:slack:sent:{user}:{sender}:{window} NX EX <2 windows>`, so 1,000 rescheduled emails still produce one message per sender per window. If Slack returns an error the message is logged, nothing is thrown, and the dedupe slot is released so the next limit hit retries.
