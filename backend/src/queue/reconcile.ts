// Startup reconciliation: rebuilds Redis execution state from Postgres (the
// source of truth). Called ONCE from worker.ts at boot. Not a scheduler: no
// timers, no intervals; it never runs in the API process.
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { prisma } from "../db/prisma.js";
import type { HourlyLimiter } from "../rateLimit/hourlyLimiter.js";
import { windowOf, windowStart } from "../rateLimit/window.js";
import { enqueueEmails, type EmailQueue } from "./emailQueue.js";

export interface ReconcileDeps {
  queue: EmailQueue;
  redis: Redis;
  /** Namespaces the reconcile lock key. */
  prefix: string;
  limiter: HourlyLimiter;
  windowMs: number;
  staleProcessingMs: number;
  chunkSize: number;
  lockTtlMs: number;
}

export interface ReconcileReport {
  skipped: boolean;
  staleReset: number;
  scanned: number;
  alreadyQueued: number;
  added: number;
  replaced: number;
  countersRaised: number;
}

// Job states that mean "this email will still be processed": leave them alone.
const LIVE_STATES = new Set(["delayed", "waiting", "active", "prioritized", "waiting-children"]);

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export async function reconcile(deps: ReconcileDeps): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    skipped: false,
    staleReset: 0,
    scanned: 0,
    alreadyQueued: 0,
    added: 0,
    replaced: 0,
    countersRaised: 0,
  };

  // Several workers may boot together; one reconcile is enough. Everything
  // below is idempotent anyway, so an expired lock only costs duplicate work.
  const lockKey = `${deps.prefix}:reconcile:lock`;
  const token = randomUUID();
  const locked = await deps.redis.set(lockKey, token, "PX", deps.lockTtlMs, "NX");
  if (locked !== "OK") return { ...report, skipped: true };

  try {
    report.staleReset = await resetStaleProcessing(deps.staleProcessingMs);
    // Counters first, so re-queued jobs can't slip past this window's limits.
    report.countersRaised = await reseedCounters(deps);
    await requeueScheduled(deps, report);
    return report;
  } finally {
    await deps.redis.eval(RELEASE_LUA, 1, lockKey, token);
  }
}

/**
 * A PROCESSING row older than the threshold belongs to a worker that died
 * mid-job. Hand it back to SCHEDULED. If that worker died AFTER the SMTP
 * server accepted the mail but BEFORE marking it SENT, this resends it: the
 * at-least-once window (the deterministic Message-ID makes it detectable).
 */
async function resetStaleProcessing(staleProcessingMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleProcessingMs);
  const { count } = await prisma.email.updateMany({
    where: {
      status: "PROCESSING",
      OR: [{ claimedAt: { lt: cutoff } }, { claimedAt: null }],
    },
    data: { status: "SCHEDULED" },
  });
  return count;
}

/**
 * Raises this window's rate-limit counters to what the DB says was SENT in
 * it (same epoch window math as the limiter). Never lowers a counter, so it
 * can't undo sends that Redis knows about and the DB doesn't yet.
 */
async function reseedCounters(deps: ReconcileDeps): Promise<number> {
  const window = windowOf(Date.now(), deps.windowMs);
  const from = new Date(windowStart(window, deps.windowMs));
  const to = new Date(windowStart(window + 1, deps.windowMs));
  const sent = await prisma.email.groupBy({
    by: ["campaignId", "senderId"],
    where: { status: "SENT", sentAt: { gte: from, lt: to } },
    _count: { _all: true },
  });

  const targets = new Map<string, number>();
  const add = (key: string, n: number) => targets.set(key, (targets.get(key) ?? 0) + n);
  for (const row of sent) {
    const [cs, s, g] = deps.limiter.keysFor(row.campaignId, row.senderId, window);
    add(cs, row._count._all);
    add(s, row._count._all);
    add(g, row._count._all);
  }
  return deps.limiter.raiseCounters(targets);
}

/** Makes sure every SCHEDULED row has exactly one live job (jobId = email.id). */
async function requeueScheduled(deps: ReconcileDeps, report: ReconcileReport): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    // Only SCHEDULED rows: SENT / FAILED are never re-queued.
    const rows = await prisma.email.findMany({
      where: { status: "SCHEDULED" },
      select: { id: true, scheduledAt: true },
      orderBy: { id: "asc" },
      take: deps.chunkSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.id;
    report.scanned += rows.length;

    const toAdd: typeof rows = [];
    await Promise.all(
      rows.map(async (row) => {
        const job = await deps.queue.getJob(row.id);
        const state = job ? await job.getState() : "missing";
        if (LIVE_STATES.has(state)) {
          report.alreadyQueued += 1;
          return;
        }
        if (job && (state === "completed" || state === "failed")) {
          // A finished job with this id would make the re-add a silent no-op.
          await job.remove();
          report.replaced += 1;
        } else {
          report.added += 1;
        }
        toAdd.push(row);
      }),
    );
    // Remaining delay from the row's scheduledAt; 0 if already past due.
    await enqueueEmails(deps.queue, toAdd, deps.chunkSize);
  }
}
