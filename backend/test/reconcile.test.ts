import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueEmail } from "../src/queue/emailQueue.js";
import type { SendFn } from "../src/queue/emailWorker.js";
import { reconcile, type ReconcileDeps } from "../src/queue/reconcile.js";
import { HourlyLimiter } from "../src/rateLimit/hourlyLimiter.js";
import { resetDb, seedCampaign } from "./helpers/seed.js";
import { createTestQueue, untilSafelyInsideWindow, waitFor } from "./helpers/testQueue.js";

const H = 3_600_000;
const MIN = 60_000;
const okSend: SendFn = async (_s, mail) => ({ messageId: mail.messageId!, previewUrl: null });

let env: ReturnType<typeof createTestQueue>;
let limiter: HourlyLimiter;

beforeEach(async () => {
  await resetDb();
  env = createTestQueue({ attempts: 1 });
  limiter = new HourlyLimiter(env.connection, {
    prefix: env.prefix,
    windowMs: H,
    perSenderCap: 0,
    globalCap: 0,
    rescheduleSpacingMs: 100,
  });
});
afterEach(() => env.cleanup());
afterAll(() => prisma.$disconnect());

function run(overrides: Partial<ReconcileDeps> = {}) {
  return reconcile({
    queue: env.queue,
    redis: env.connection,
    prefix: env.prefix,
    limiter,
    windowMs: H,
    staleProcessingMs: 10 * MIN,
    chunkSize: 500,
    lockTtlMs: 10_000,
    ...overrides,
  });
}

const stateOf = async (id: string) => (await env.queue.getJob(id))?.getState() ?? "missing";

describe("reconcile: SCHEDULED rows vs BullMQ jobs", () => {
  it("re-adds a missing job with the remaining delay", async () => {
    const { emails } = await seedCampaign({
      count: 1,
      hourlyLimit: 10,
      scheduledAt: new Date(Date.now() + MIN),
    });
    const report = await run();

    expect(report).toMatchObject({ added: 1, alreadyQueued: 0, replaced: 0 });
    const job = (await env.queue.getJob(emails[0]!.id))!;
    expect(await job.getState()).toBe("delayed");
    expect(job.data).toEqual({ emailId: emails[0]!.id });
    expect(
      Math.abs(job.timestamp + job.opts.delay! - emails[0]!.scheduledAt.getTime()),
    ).toBeLessThan(1000);
  });

  it("gives a past-due row delay 0 (sent as soon as possible)", async () => {
    const { emails } = await seedCampaign({
      count: 1,
      hourlyLimit: 10,
      scheduledAt: new Date(Date.now() - 30 * MIN),
    });
    await run();
    const job = (await env.queue.getJob(emails[0]!.id))!;
    expect(job.opts.delay).toBe(0);
    expect(await job.getState()).toBe("waiting");
  });

  it("leaves an existing delayed job untouched (no duplicate, same job)", async () => {
    const { emails } = await seedCampaign({
      count: 1,
      hourlyLimit: 10,
      scheduledAt: new Date(Date.now() + MIN),
    });
    const original = await enqueueEmail(env.queue, emails[0]!);
    const report = await run();

    expect(report).toMatchObject({ added: 0, alreadyQueued: 1, replaced: 0 });
    const job = (await env.queue.getJob(emails[0]!.id))!;
    expect(job.timestamp).toBe(original.timestamp);
    expect(await env.queue.getJobCounts("delayed", "waiting")).toEqual({ delayed: 1, waiting: 0 });
  });

  it("replaces a COMPLETED job whose row is still SCHEDULED", async () => {
    const { emails } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    const id = emails[0]!.id;
    await prisma.email.update({ where: { id }, data: { status: "SENT" } }); // so the job completes as "skipped"
    await enqueueEmail(env.queue, emails[0]!);
    const worker = env.startWorker(okSend, 1);
    await waitFor(async () => (await stateOf(id)) === "completed");
    await worker.close();
    await prisma.email.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledAt: new Date(Date.now() + MIN) },
    });

    expect(await run()).toMatchObject({ replaced: 1, added: 0 });
    expect(await stateOf(id)).toBe("delayed");
  });

  it("replaces a FAILED job whose row is still SCHEDULED", async () => {
    const { emails } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    const id = emails[0]!.id;
    await enqueueEmail(env.queue, emails[0]!);
    const worker = env.startWorker(async () => {
      throw new Error("SMTP down");
    }, 1);
    await waitFor(async () => (await stateOf(id)) === "failed");
    await worker.close();
    await prisma.email.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledAt: new Date(Date.now() + MIN) },
    });

    expect(await run()).toMatchObject({ replaced: 1 });
    expect(await stateOf(id)).toBe("delayed");
  });

  it("never queues SENT or FAILED rows", async () => {
    const { emails } = await seedCampaign({ count: 3, hourlyLimit: 10 });
    await prisma.email.update({
      where: { id: emails[0]!.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    await prisma.email.update({ where: { id: emails[1]!.id }, data: { status: "FAILED" } });
    const report = await run();

    expect(report).toMatchObject({ scanned: 1, added: 1 });
    expect(await stateOf(emails[0]!.id)).toBe("missing");
    expect(await stateOf(emails[1]!.id)).toBe("missing");
    expect(await stateOf(emails[2]!.id)).not.toBe("missing");
  });

  it("handles thousands of rows in chunks", async () => {
    const { campaign, user, senders } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    const sender = senders[0];
    const due = new Date(Date.now() + 10 * MIN);
    await prisma.email.createMany({
      data: Array.from({ length: 1200 }, (_, i) => ({
        campaignId: campaign.id,
        userId: user.id,
        senderId: sender!.id,
        seq: i + 1,
        toEmail: `bulk${i}@example.com`,
        subject: "s",
        body: "b",
        scheduledAt: due,
      })),
    });
    const report = await run({ chunkSize: 500 });
    expect(report).toMatchObject({ scanned: 1201, added: 1201 });
    // 1200 future rows -> delayed; the seeded campaign's own past-due row -> waiting
    expect(await env.queue.getJobCounts("delayed", "waiting")).toEqual({
      delayed: 1200,
      waiting: 1,
    });
  }, 30_000);
});

describe("reconcile: stale PROCESSING rows", () => {
  it("resets a stale PROCESSING row to SCHEDULED and queues it; leaves a fresh one alone", async () => {
    const { emails } = await seedCampaign({ count: 2, hourlyLimit: 10 });
    const [stale, fresh] = emails;
    await prisma.email.update({
      where: { id: stale!.id },
      data: { status: "PROCESSING", claimedAt: new Date(Date.now() - 11 * MIN) },
    });
    await prisma.email.update({
      where: { id: fresh!.id },
      data: { status: "PROCESSING", claimedAt: new Date(Date.now() - 1 * MIN) },
    });

    const report = await run();
    expect(report).toMatchObject({ staleReset: 1, added: 1 });
    expect((await prisma.email.findUniqueOrThrow({ where: { id: stale!.id } })).status).toBe(
      "SCHEDULED",
    );
    expect(await stateOf(stale!.id)).not.toBe("missing");
    expect((await prisma.email.findUniqueOrThrow({ where: { id: fresh!.id } })).status).toBe(
      "PROCESSING",
    );
    expect(await stateOf(fresh!.id)).toBe("missing");
  });
});

describe("reconcile: rate-limit counters", () => {
  it("raises this window's counters to the DB's SENT counts and never lowers them", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    const now = Date.now();
    const window = Math.floor(now / H);
    const { campaign, senders, emails } = await seedCampaign({ count: 5, hourlyLimit: 10 });
    const sender = senders[0]!.id;
    for (const e of emails.slice(0, 3)) {
      await prisma.email.update({
        where: { id: e.id },
        data: { status: "SENT", sentAt: new Date(now) },
      });
    }
    // sent in the PREVIOUS window: must not count
    await prisma.email.update({
      where: { id: emails[3]!.id },
      data: { status: "SENT", sentAt: new Date(now - H) },
    });

    const [cs, s, g] = limiter.keysFor(campaign.id, sender, window);
    await env.connection.set(cs!, "1"); // lower than DB (3) -> raised
    await env.connection.set(s!, "5"); // higher than DB (3) -> kept

    await run();
    expect(await env.connection.get(cs!)).toBe("3");
    expect(await env.connection.get(s!)).toBe("5");
    expect(await env.connection.get(g!)).toBe("3");
    expect(await env.connection.ttl(cs!)).toBeGreaterThan(7000);
  });
});

describe("reconcile: concurrency and idempotency", () => {
  it("two reconciles at once: one runs, one skips on the lock, one job per row", async () => {
    await seedCampaign({ count: 20, hourlyLimit: 10, scheduledAt: new Date(Date.now() + MIN) });
    const [a, b] = await Promise.all([run(), run()]);

    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
    expect((await env.queue.getJobCounts("delayed")).delayed).toBe(20);
  });

  it("even without the lock (expired / overlapping), re-adding is a no-op per jobId", async () => {
    await seedCampaign({ count: 20, hourlyLimit: 10, scheduledAt: new Date(Date.now() + MIN) });
    await Promise.all([run({ lockTtlMs: 1 }), run({ prefix: `${env.prefix}-other-lock` })]);
    expect((await env.queue.getJobCounts("delayed")).delayed).toBe(20);
  });

  it("is safe to run twice in a row (second run adds nothing) and releases its lock", async () => {
    await seedCampaign({ count: 5, hourlyLimit: 10, scheduledAt: new Date(Date.now() + MIN) });
    expect(await run()).toMatchObject({ skipped: false, added: 5 });
    expect(await run()).toMatchObject({ skipped: false, added: 0, alreadyQueued: 5 });
  });
});
