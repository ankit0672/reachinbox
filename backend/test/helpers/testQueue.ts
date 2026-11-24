import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { Worker } from "bullmq";
import { createEmailQueue } from "../../src/queue/emailQueue.js";
import { createEmailWorker, type SendFn } from "../../src/queue/emailWorker.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

/**
 * An isolated BullMQ namespace: a unique key prefix per call, so tests never
 * see or touch dev jobs (which live under the "reachinbox" prefix).
 * cleanup() closes everything and deletes every key under the prefix.
 */
export function createTestQueue(opts: { attempts?: number; backoffMs?: number } = {}) {
  const prefix = `reachinbox-test-${randomUUID()}`;
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = createEmailQueue({
    connection,
    prefix,
    attempts: opts.attempts ?? 3,
    backoffMs: opts.backoffMs ?? 50,
  });
  const workers: Worker[] = [];

  return {
    prefix,
    queue,
    startWorker(send: SendFn, concurrency = 5) {
      const worker = createEmailWorker({ connection, prefix, concurrency, send });
      workers.push(worker);
      return worker;
    },
    async cleanup() {
      await Promise.all(workers.map((w) => w.close()));
      await queue.obliterate({ force: true });
      await queue.close();
      const keys = await connection.keys(`${prefix}:*`);
      if (keys.length) await connection.del(...keys);
      await connection.quit();
    },
  };
}

/** Polls until `check` returns a truthy value or the timeout elapses. */
export async function waitFor<T>(check: () => Promise<T>, timeoutMs = 10_000, everyMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
