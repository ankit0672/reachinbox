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
npm run seed:emails -- 3 5000 # dev-only: insert 3 email rows due in 5s and enqueue them (until the M4 API exists)
npm test                      # vitest; needs compose up
```

Tests use their own BullMQ key prefix (`reachinbox-test-<uuid>`) and delete every key under it afterwards, so they never touch dev jobs under `reachinbox:`.

## Schedule API (so far)

Until Google login lands (M8), `/api/*` identifies the user with a **dev-only** `X-Dev-User-Email` header (the middleware refuses to start when `NODE_ENV=production`).

```bash
curl -X POST localhost:3001/api/schedule \
  -H 'Content-Type: application/json' -H 'X-Dev-User-Email: you@example.com' \
  -d '{"subject":"Hi","body":"Hello","startTime":"2026-12-01T10:00:00Z",
       "delayBetweenMs":2000,"hourlyLimit":50,"leads":["a@example.com","b@example.com"]}'
```

- Leads are trimmed, lowercased, validated and deduped on the server; the response reports `received / accepted / duplicate / invalid` (client-supplied counts are ignored).
- `startTime` must include a timezone. A past `startTime` is sent as soon as possible.
- `hourlyLimit` is **per sender**: each sender sends at most this many of the campaign's emails per window (so with 3 senders and `hourlyLimit: 50`, the campaign can send up to 150 per hour).
- Leads are pre-packed into hourly windows at schedule time (see *Rate limiting* below); each email stores its lead position as `seq`.
- The campaign and all its email rows are written in one transaction; jobs are enqueued only after it commits, in `ENQUEUE_CHUNK_SIZE` batches. If Redis fails part-way, the API answers `503` with how many were queued, and the rows stay `SCHEDULED` for reconciliation to re-queue.
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
