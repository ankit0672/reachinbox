// Worker process entry: runs separately from the API so either can be
// killed and restarted independently.
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createEmailQueue } from "./queue/emailQueue.js";
import { createEmailWorker } from "./queue/emailWorker.js";
import { reconcile } from "./queue/reconcile.js";
import { HourlyLimiter } from "./rateLimit/hourlyLimiter.js";
import { redis } from "./redis/connection.js";
import { emailIndex, esClient } from "./search/client.js";
import { bestEffort } from "./search/emailIndex.js";
import { closeTransports } from "./services/mailer.js";
import { ensureSenderPool } from "./services/senderService.js";

const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);
await bestEffort(`ensure index ${emailIndex.name}`, () => emailIndex.ensureIndex());

const limiter = new HourlyLimiter(redis, {
  prefix: env.BULLMQ_PREFIX,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  perSenderCap: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  globalCap: env.MAX_EMAILS_PER_HOUR,
  rescheduleSpacingMs: env.RESCHEDULE_SPACING_MS,
});

// Runs once at boot, before this worker takes jobs: rebuild Redis from the DB
// (missing jobs, stale claims, this window's counters). Best effort: a failure
// is logged and the worker still starts, serving whatever jobs exist.
const queue = createEmailQueue({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  attempts: env.EMAIL_JOB_ATTEMPTS,
  backoffMs: env.EMAIL_JOB_BACKOFF_MS,
});
try {
  const report = await reconcile({
    queue,
    redis,
    prefix: env.BULLMQ_PREFIX,
    limiter,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    staleProcessingMs: env.STALE_PROCESSING_MS,
    chunkSize: env.RECONCILE_CHUNK_SIZE,
    lockTtlMs: env.RECONCILE_LOCK_MS,
  });
  console.log(
    report.skipped
      ? "[worker] reconcile skipped: another worker holds the lock"
      : `[worker] reconcile: scanned=${report.scanned} alreadyQueued=${report.alreadyQueued} ` +
          `added=${report.added} replaced=${report.replaced} staleReset=${report.staleReset} ` +
          `countersRaised=${report.countersRaised}`,
  );
} catch (err) {
  console.error("[worker] reconcile FAILED (continuing):", err);
}

const worker = createEmailWorker({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  concurrency: env.WORKER_CONCURRENCY,
  limiter,
  minDelayMs: env.MIN_DELAY_BETWEEN_SENDS_MS,
  search: emailIndex,
});

worker.on("ready", () =>
  console.log(
    `[worker] ready: concurrency=${env.WORKER_CONCURRENCY}, senders=${senders.length}, ` +
      `minDelay=${env.MIN_DELAY_BETWEEN_SENDS_MS}ms, window=${env.RATE_LIMIT_WINDOW_MS}ms, ` +
      `perSenderCap=${env.MAX_EMAILS_PER_HOUR_PER_SENDER || "off"}, globalCap=${env.MAX_EMAILS_PER_HOUR || "off"}`,
  ),
);
worker.on("completed", (job, result) => console.log(`[worker] job ${job.id} ${result}`));
worker.on("failed", (job, err) =>
  console.error(
    `[worker] job ${job?.id} attempt ${job?.attemptsMade}/${job?.opts.attempts} failed: ${err.message}`,
  ),
);
worker.on("error", (err) => console.error("[worker] error:", err.message));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received: finishing active jobs, taking no new ones`);
  // close() waits for in-flight jobs, so a send is never cut off between SMTP and the DB update.
  await worker.close();
  await queue.close();
  closeTransports();
  await Promise.allSettled([prisma.$disconnect(), redis.quit(), esClient.close()]);
  console.log("[worker] shut down cleanly");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
