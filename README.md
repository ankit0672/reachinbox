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
