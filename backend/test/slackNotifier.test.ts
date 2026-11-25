import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { encryptSecret } from "../src/lib/encryption.js";
import { enqueueEmails } from "../src/queue/emailQueue.js";
import type { SendFn } from "../src/queue/emailWorker.js";
import { HourlyLimiter } from "../src/rateLimit/hourlyLimiter.js";
import type { RateLimitEvent } from "../src/services/rateLimitNotifier.js";
import { createSlackNotifier } from "../src/services/slackNotifier.js";
import { SlackApi } from "../src/slack/slackApi.js";
import { startFakeSlack } from "./helpers/fakeSlack.js";
import { resetDb, seedCampaign } from "./helpers/seed.js";
import { createTestQueue, untilSafelyInsideWindow, waitFor } from "./helpers/testQueue.js";

const H = 3_600_000;
const KEY = "0123456789abcdef".repeat(4);
let slack: Awaited<ReturnType<typeof startFakeSlack>>;
let env: ReturnType<typeof createTestQueue>;
let seeded: Awaited<ReturnType<typeof seedCampaign>>;

const notifier = () =>
  createSlackNotifier({
    redis: env.connection,
    prefix: env.prefix,
    api: new SlackApi(slack.apiBaseUrl),
    encryptionKey: KEY,
    windowMs: H,
  });

const event = (over: Partial<RateLimitEvent> = {}): RateLimitEvent => ({
  userId: seeded.user.id,
  campaignId: seeded.campaign.id,
  emailId: "e1",
  senderId: seeded.senders[0]!.id,
  senderEmail: "sender1@ethereal.test",
  blockedBy: "campaign",
  limit: 3,
  window: 500_000,
  resumeAt: new Date(Date.UTC(2027, 0, 1, 9, 0)),
  ...over,
});

async function connectSlack(token = "xoxb-test-token") {
  slack.installs.set(`code-${token}`, {
    teamId: "T1",
    teamName: "dev",
    authedUserId: "U1",
    botToken: token,
  });
  await prisma.slackConnection.create({
    data: {
      userId: seeded.user.id,
      teamId: "T1",
      teamName: "dev",
      botToken: encryptSecret(token, KEY),
      channelId: "D-U1",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await prisma.slackConnection.deleteMany();
  slack = await startFakeSlack();
  env = createTestQueue();
  seeded = await seedCampaign({ count: 1, hourlyLimit: 3 });
});
afterEach(async () => {
  await slack.close();
  await env.cleanup();
});
afterAll(() => prisma.$disconnect());

describe("Slack rate-limit notifier", () => {
  it("not connected: no Slack call, no crash, logged once per sender per window", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const notify = notifier();
    await notify(event());
    await notify(event({ emailId: "e2" }));
    expect(slack.calls).toHaveLength(0);
    expect(log.mock.calls.flat().filter((l) => /no Slack connection/.test(String(l)))).toHaveLength(
      1,
    );
    log.mockRestore();
  });

  it("connected: one DM via the decrypted bot token, describing the limit and when sending resumes", async () => {
    await connectSlack();
    await notifier()(event());
    const [post] = slack.callsTo("chat.postMessage");
    expect(post).toMatchObject({ token: "xoxb-test-token", body: { channel: "D-U1" } });
    expect(post!.body.text).toMatch(/sender1@ethereal\.test/);
    expect(post!.body.text).toMatch(/3 emails per sender per hour/);
    expect(post!.body.text).toMatch(/2027-01-01 09:00 UTC/);
  });

  it("deduped: one message per user, sender and window, however many emails hit the limit", async () => {
    await connectSlack();
    const notify = notifier();
    await Promise.all(Array.from({ length: 10 }, (_, i) => notify(event({ emailId: `e${i}` }))));
    expect(slack.callsTo("chat.postMessage")).toHaveLength(1);

    await notify(event({ window: 500_001 })); // next window
    await notify(event({ senderId: "another-sender" })); // another sender
    expect(slack.callsTo("chat.postMessage")).toHaveLength(3);
  });

  it("a Slack failure is logged, never thrown, and the dedupe slot is released for a retry", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await connectSlack();
    slack.state.postError = "channel_not_found";
    const notify = notifier();
    await expect(notify(event())).resolves.toBeUndefined();
    expect(errors.mock.calls.flat().join(" ")).toMatch(/channel_not_found/);

    slack.state.postError = undefined;
    await notify(event({ emailId: "e2" }));
    expect(slack.callsTo("chat.postMessage")).toHaveLength(2); // the failed one + the retry
    errors.mockRestore();
  });

  it("connecting later works without a restart (connection is looked up at notify time)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const notify = notifier();
    await notify(event());
    expect(slack.calls).toHaveLength(0);
    await connectSlack();
    await notify(event({ emailId: "e2" })); // same notifier instance, same window
    expect(slack.callsTo("chat.postMessage")).toHaveLength(1);
    log.mockRestore();
  });
});

describe("end to end with the worker", () => {
  it("4 due emails, limit 1: 3 rescheduled, exactly one Slack message", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    await resetDb();
    seeded = await seedCampaign({ count: 4, hourlyLimit: 1 });
    await connectSlack();
    const send: SendFn = async (_s, mail) => ({ messageId: mail.messageId!, previewUrl: null });
    const limiter = new HourlyLimiter(env.connection, {
      prefix: env.prefix,
      windowMs: H,
      perSenderCap: 0,
      globalCap: 0,
      rescheduleSpacingMs: 100,
    });
    env.startWorker(send, 1, { limiter, onRateLimited: notifier() });
    await enqueueEmails(env.queue, seeded.emails, 500);

    await waitFor(async () => (await env.queue.getJobCounts("delayed")).delayed === 3);
    await waitFor(async () => slack.callsTo("chat.postMessage").length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(slack.callsTo("chat.postMessage")).toHaveLength(1);
    expect(await prisma.email.count({ where: { status: "SENT" } })).toBe(1);
  });
});
