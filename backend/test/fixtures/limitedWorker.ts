// Child process for the two-worker race test: a real BullMQ worker with the
// real Lua limiter and DB claim, but a fake SMTP send that records to Redis.
// Configured entirely through env vars by test/twoWorkers.test.ts.
import { Redis } from "ioredis";
import { prisma } from "../../src/db/prisma.js";
import { createEmailWorker } from "../../src/queue/emailWorker.js";
import { HourlyLimiter } from "../../src/rateLimit/hourlyLimiter.js";

const prefix = process.env.TEST_PREFIX!;
const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
  maxRetriesPerRequest: null,
});
const limiter = new HourlyLimiter(connection, {
  prefix,
  windowMs: Number(process.env.TEST_WINDOW_MS),
  perSenderCap: 0,
  globalCap: 0,
  rescheduleSpacingMs: 100,
});

const worker = createEmailWorker({
  connection,
  prefix,
  concurrency: 5,
  limiter,
  send: async (_sender, mail) => {
    await connection.rpush(`${prefix}:test:sent`, `${process.pid} ${mail.messageId}`);
    await new Promise((r) => setTimeout(r, 20));
    return { messageId: mail.messageId!, previewUrl: null };
  },
});
worker.on("active", () => void connection.sadd(`${prefix}:test:pids`, String(process.pid)));
worker.on("ready", () => console.log("READY"));

process.on("SIGTERM", async () => {
  await worker.close();
  await Promise.allSettled([connection.quit(), prisma.$disconnect()]);
  process.exit(0);
});
