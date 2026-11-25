import { createApp } from "./app.js";
import { authConfigFromEnv } from "./auth/config.js";
import { env } from "./config/env.js";
import { closeInfraClients, realHealthChecks } from "./health/realChecks.js";
import { createEmailQueue } from "./queue/emailQueue.js";
import { redis } from "./redis/connection.js";
import { bestEffort } from "./search/emailIndex.js";
import { emailIndex } from "./search/client.js";
import { ensureSenderPool } from "./services/senderService.js";
import { SlackApi } from "./slack/slackApi.js";

// First boot creates the Ethereal sender pool; later boots find it in the DB.
const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);
console.log(`[api] sender pool ready (${senders.length} senders)`);

const emailQueue = createEmailQueue({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  attempts: env.EMAIL_JOB_ATTEMPTS,
  backoffMs: env.EMAIL_JOB_BACKOFF_MS,
});

// Idempotent; if Elasticsearch is down the API still starts (search answers 503).
await bestEffort(`ensure index ${emailIndex.name}`, () => emailIndex.ensureIndex());

const auth = authConfigFromEnv();
if (!auth.google) {
  console.warn("[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set: Google login is disabled");
}

const slackConfig =
  env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_REDIRECT_URL
    ? {
        clientId: env.SLACK_CLIENT_ID,
        clientSecret: env.SLACK_CLIENT_SECRET,
        redirectUrl: env.SLACK_REDIRECT_URL,
      }
    : undefined;
console.log(
  slackConfig
    ? `[slack] OAuth callback expected at ${slackConfig.redirectUrl} (must match the Slack app's Redirect URL)`
    : "[slack] SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_REDIRECT_URL not set: Connect Slack is disabled",
);

const app = createApp(realHealthChecks, {
  auth,
  slack: {
    config: slackConfig,
    api: new SlackApi(),
    redis,
    prefix: env.BULLMQ_PREFIX,
    encryptionKey: env.ENCRYPTION_KEY,
  },
  emails: { maxPageSize: env.LIST_MAX_PAGE_SIZE },
  schedule: { emailQueue, enqueueChunkSize: env.ENQUEUE_CHUNK_SIZE, search: emailIndex },
  search: { index: emailIndex, maxPageSize: env.SEARCH_MAX_PAGE_SIZE },
  bullBoard: {
    queue: emailQueue,
    user: env.BULL_BOARD_USER,
    pass: env.BULL_BOARD_PASS,
    nodeEnv: env.NODE_ENV,
  },
});

const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
  console.log(`[api] Bull Board: http://localhost:${env.API_PORT}/admin/queues`);
  console.log(`[api] Google login: http://localhost:${env.API_PORT}/api/auth/google`);
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
