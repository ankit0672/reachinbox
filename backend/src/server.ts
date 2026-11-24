import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeInfraClients, realHealthChecks } from "./health/realChecks.js";
import { createEmailQueue } from "./queue/emailQueue.js";
import { redis } from "./redis/connection.js";
import { ensureSenderPool } from "./services/senderService.js";

// First boot creates the Ethereal sender pool; later boots find it in the DB.
const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);
console.log(`[api] sender pool ready (${senders.length} senders)`);

const emailQueue = createEmailQueue({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  attempts: env.EMAIL_JOB_ATTEMPTS,
  backoffMs: env.EMAIL_JOB_BACKOFF_MS,
});

const app = createApp(realHealthChecks, {
  schedule: { emailQueue, enqueueChunkSize: env.ENQUEUE_CHUNK_SIZE },
});

const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
});

function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => {
    void emailQueue
      .close()
      .then(closeInfraClients)
      .finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
