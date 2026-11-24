// Worker process entry: runs separately from the API so either can be
// killed and restarted independently.
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createEmailWorker } from "./queue/emailWorker.js";
import { HourlyLimiter } from "./rateLimit/hourlyLimiter.js";
import { redis } from "./redis/connection.js";
import { closeTransports } from "./services/mailer.js";
import { ensureSenderPool } from "./services/senderService.js";

const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);

const limiter = new HourlyLimiter(redis, {
  prefix: env.BULLMQ_PREFIX,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  perSenderCap: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  globalCap: env.MAX_EMAILS_PER_HOUR,
  rescheduleSpacingMs: env.RESCHEDULE_SPACING_MS,
});

const worker = createEmailWorker({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  concurrency: env.WORKER_CONCURRENCY,
  limiter,
  minDelayMs: env.MIN_DELAY_BETWEEN_SENDS_MS,
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
  closeTransports();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  console.log("[worker] shut down cleanly");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
