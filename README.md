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
cd backend && npm install
npm run dev:api               # API on http://localhost:3001
curl localhost:3001/health    # 200 when DB, Redis and ES are all reachable
npm test                      # vitest (the real-infra health test needs compose up)
```
