import { Redis } from "ioredis";
import { env } from "../config/env.js";

// BullMQ requires maxRetriesPerRequest: null on the shared connection.
// Side effect: commands wait forever while Redis is down, so callers that
// must not hang (the health check) have to apply their own timeout.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// ioredis wraps connection failures in an AggregateError whose message is empty.
redis.on("error", (err) =>
  console.error("[redis] connection error:", err.message || err.name || String(err)),
);
