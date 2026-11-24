import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeInfraClients, realHealthChecks } from "./health/realChecks.js";
import { ensureSenderPool } from "./services/senderService.js";

// First boot creates the Ethereal sender pool; later boots find it in the DB.
const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);
console.log(`[api] sender pool ready (${senders.length} senders)`);

const server = createApp(realHealthChecks).listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
});

function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => {
    void closeInfraClients().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
