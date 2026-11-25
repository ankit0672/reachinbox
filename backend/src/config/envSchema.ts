import { z } from "zod";

// Pure schema, no dotenv/process access, so it can be unit tested.
// Variables are added here milestone by milestone as code starts using them;
// .env.example already lists the later ones (limits, Google, Slack, ...).
const schema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  ELASTICSEARCH_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.url().default("http://localhost:5173"),
  SENDER_POOL_SIZE: z.coerce.number().int().positive().default(3),
  // Schedule API
  MAX_LEADS_PER_CAMPAIGN: z.coerce.number().int().positive().default(10_000),
  MAX_EMAIL_BODY_CHARS: z.coerce.number().int().positive().default(20_000),
  ENQUEUE_CHUNK_SIZE: z.coerce.number().int().positive().default(500),
  // Queue / worker
  BULLMQ_PREFIX: z.string().min(1).default("reachinbox"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  EMAIL_JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
  EMAIL_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
  // Rate limiting. Every cap uses 0 = off.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3_600_000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(0).default(100),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().min(0).default(0),
  MIN_DELAY_BETWEEN_SENDS_MS: z.coerce.number().int().min(0).default(2000),
  RESCHEDULE_SPACING_MS: z.coerce.number().int().min(0).default(1000),
  PLANNING_HORIZON_DAYS: z.coerce.number().int().positive().default(30),
  SCHEDULE_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Crash recovery (worker boot reconcile)
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  STALE_PROCESSING_MS: z.coerce.number().int().positive().default(600_000),
  RECONCILE_CHUNK_SIZE: z.coerce.number().int().positive().default(500),
  RECONCILE_LOCK_MS: z.coerce.number().int().positive().default(60_000),
  // Elasticsearch / search
  ES_INDEX_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, digits, - and _ only")
    .default("reachinbox"),
  ES_BULK_CHUNK_SIZE: z.coerce.number().int().positive().default(500),
  ES_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SEARCH_MAX_PAGE_SIZE: z.coerce.number().int().positive().max(1000).default(100),
  // Bull Board basic auth; empty = not configured
  BULL_BOARD_USER: z.string().optional(),
  BULL_BOARD_PASS: z.string().optional(),
});

// BullMQ's default job lock is 30s; a send can take up to connect + greeting +
// socket timeouts. A PROCESSING row younger than that may still be mid-send.
const BULLMQ_LOCK_MS = 30_000;
const checked = schema.superRefine((env, ctx) => {
  const minStale = 3 * env.SMTP_TIMEOUT_MS + BULLMQ_LOCK_MS;
  if (env.STALE_PROCESSING_MS < minStale) {
    ctx.addIssue({
      code: "custom",
      path: ["STALE_PROCESSING_MS"],
      message: `must be at least 3 x SMTP_TIMEOUT_MS + ${BULLMQ_LOCK_MS}ms (${minStale}ms), or live sends could be reset`,
    });
  }
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = checked.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${problems}`);
}
