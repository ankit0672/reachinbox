import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueEmails } from "../src/queue/emailQueue.js";
import type { SendFn } from "../src/queue/emailWorker.js";
import { HourlyLimiter } from "../src/rateLimit/hourlyLimiter.js";
import { resetDb, seedCampaign } from "./helpers/seed.js";
import { createTestQueue, untilSafelyInsideWindow, waitFor } from "./helpers/testQueue.js";

const H = 3_600_000;

function recordingSend(fail?: (call: number) => boolean) {
  const sentAt: { emailId: string; at: number }[] = [];
  let calls = 0;
  const send = vi.fn<SendFn>(async (_sender, mail) => {
    calls += 1;
    if (fail?.(calls)) throw new Error("SMTP 451 temporary failure");
    const emailId = mail.messageId!.slice(1).split("@")[0]!;
    sentAt.push({ emailId, at: Date.now() });
    return { messageId: mail.messageId!, previewUrl: null };
  });
  return { send, sentAt };
}

let env: ReturnType<typeof createTestQueue>;
const limiterFor = (windowMs: number, spacing = 100) =>
  new HourlyLimiter(env.connection, {
    prefix: env.prefix,
    windowMs,
    perSenderCap: 0,
    globalCap: 0,
    rescheduleSpacingMs: spacing,
  });

beforeEach(async () => {
  await resetDb();
  env = createTestQueue();
});
afterEach(() => env.cleanup());
afterAll(() => prisma.$disconnect());

const rows = (campaignId: string) =>
  prisma.email.findMany({ where: { campaignId }, orderBy: { seq: "asc" } });

describe("runtime hourly limit", () => {
  it("8 due emails, limit 3: 3 sent, 5 moved to the next window in order, none failed or dropped", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    const window = Math.floor(Date.now() / H);
    const { campaign, emails, senders, user } = await seedCampaign({ count: 8, hourlyLimit: 3 });
    const { send } = recordingSend();
    const onRateLimited = vi.fn();
    env.startWorker(send, 1, { limiter: limiterFor(H), onRateLimited });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => {
      const r = await rows(campaign.id);
      return r.filter((e) => e.status === "SENT").length === 3 &&
        r.filter((e) => e.status === "SCHEDULED" && e.scheduledAt.getTime() >= (window + 1) * H)
          .length === 5
        ? r
        : null;
    });
    const final = await rows(campaign.id);
    expect(final).toHaveLength(8);
    expect(final.slice(0, 3).map((e) => e.status)).toEqual(["SENT", "SENT", "SENT"]);

    const moved = final.slice(3);
    const times = moved.map((e) => e.scheduledAt.getTime());
    expect(times.every((t) => Math.floor(t / H) === window + 1)).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => a - b)); // order preserved: seq 3..7
    expect(new Set(times).size).toBe(5);
    expect(moved.every((e) => e.attempts === 0)).toBe(true); // a limit hit is not an attempt

    for (const e of moved) {
      const job = await env.queue.getJob(e.id);
      expect(await job!.getState()).toBe("delayed");
      expect(job!.attemptsMade).toBe(0);
    }
    expect(await env.queue.getJobCounts("failed")).toEqual({ failed: 0 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(
      await env.connection.get(`${env.prefix}:rl:cs:${campaign.id}:${senders[0]!.id}:${window}`),
    ).toBe("3");

    // M9 Slack hook call point: fired once per rescheduled email, never awaited.
    expect(onRateLimited).toHaveBeenCalledTimes(5);
    expect(onRateLimited.mock.calls[0]![0]).toMatchObject({
      userId: user.id,
      senderId: senders[0]!.id,
      blockedBy: "campaign",
      limit: 3,
    });
  });

  it("a rate-limited job never calls SMTP", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    const { emails } = await seedCampaign({ count: 2, hourlyLimit: 1 });
    const { send } = recordingSend();
    env.startWorker(send, 1, { limiter: limiterFor(H) });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => (await env.queue.getJobCounts("delayed")).delayed === 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1].to).toBe("lead0@example.com");
  });

  it("a failed send refunds its counters (retry then success counts once)", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    const window = Math.floor(Date.now() / H);
    const { campaign, emails, senders } = await seedCampaign({ count: 1, hourlyLimit: 5 });
    const { send } = recordingSend((call) => call === 1);
    env.startWorker(send, 1, { limiter: limiterFor(H) });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => (await rows(campaign.id))[0]!.status === "SENT");
    const s = senders[0]!.id;
    expect(await env.connection.get(`${env.prefix}:rl:cs:${campaign.id}:${s}:${window}`)).toBe("1");
    expect(await env.connection.get(`${env.prefix}:rl:s:${s}:${window}`)).toBe("1");
    expect(await env.connection.get(`${env.prefix}:rl:g:${window}`)).toBe("1");
  });

  it("a permanently failed send leaves the counters at zero", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    const window = Math.floor(Date.now() / H);
    const { campaign, emails, senders } = await seedCampaign({ count: 1, hourlyLimit: 5 });
    const { send } = recordingSend(() => true);
    env.startWorker(send, 1, { limiter: limiterFor(H) });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => (await rows(campaign.id))[0]!.status === "FAILED");
    expect(await env.connection.get(`${env.prefix}:rl:s:${senders[0]!.id}:${window}`)).toBe("0");
  });

  it("with a 2s window, all 8 eventually send: never more than 3 per window, in seq order", async () => {
    const windowMs = 2000;
    await untilSafelyInsideWindow(windowMs, 1500); // start just after a window opens
    const { campaign, emails } = await seedCampaign({ count: 8, hourlyLimit: 3 });
    const { send, sentAt } = recordingSend();
    env.startWorker(send, 1, { limiter: limiterFor(windowMs, 50) });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => sentAt.length === 8, 12_000);
    const perWindow = new Map<number, number>();
    for (const s of sentAt) {
      const w = Math.floor(s.at / windowMs);
      perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
    }
    expect(Math.max(...perWindow.values())).toBeLessThanOrEqual(3);
    const seqById = new Map(emails.map((e) => [e.id, e.seq]));
    expect(sentAt.map((s) => seqById.get(s.emailId))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // The fake send records before the worker writes SENT, so wait for the DB to catch up.
    await waitFor(async () => (await rows(campaign.id)).every((e) => e.status === "SENT"));
  }, 20_000);
});

describe("global min delay (BullMQ limiter)", () => {
  it("spaces consecutive sends by at least MIN_DELAY_BETWEEN_SENDS_MS", async () => {
    const { emails } = await seedCampaign({ count: 3, hourlyLimit: 100 });
    const { send, sentAt } = recordingSend();
    env.startWorker(send, 5, { minDelayMs: 400 });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => sentAt.length === 3);
    const gaps = sentAt.slice(1).map((s, i) => s.at - sentAt[i]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(380);
  });
});
