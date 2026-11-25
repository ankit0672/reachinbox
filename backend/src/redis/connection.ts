import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { describeError } from "../lib/describeError.js";

// BullMQ requires maxRetriesPerRequest: null on the shared connection.
// Side effect: commands wait forever while Redis is down, so callers that
// must not hang (the health check) have to apply their own timeout.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

redis.on("error", (err) => console.error("[redis] connection error:", describeError(err)));
