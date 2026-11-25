import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueEmails } from "../src/queue/emailQueue.js";
import type { SendFn } from "../src/queue/emailWorker.js";
import { HourlyLimiter } from "../src/rateLimit/hourlyLimiter.js";
import type { EmailDoc } from "../src/search/emailIndex.js";
import { resetDb, seedCampaign } from "./helpers/seed.js";
import { createTestIndex, deadIndex } from "./helpers/testIndex.js";
import { createTestQueue, untilSafelyInsideWindow, waitFor } from "./helpers/testQueue.js";

const H = 3_600_000;
const okSend: SendFn = async (_s, mail) => ({ messageId: mail.messageId!, previewUrl: null });

let env: ReturnType<typeof createTestQueue>;
let t: Awaited<ReturnType<typeof createTestIndex>>;

beforeEach(async () => {
  await resetDb();
  env = createTestQueue({ attempts: 1 });
  t = await createTestIndex();
});
afterEach(async () => {
  await env.cleanup();
  await t.cleanup();
});
afterAll(() => prisma.$disconnect());

const esDoc = (id: string, match: (d: EmailDoc) => boolean) =>
  waitFor(async () => {
    const d = await t.get(id);
    return d && match(d) ? d : null;
  });

describe("worker keeps Elasticsearch in sync", () => {
  it("SENT is reflected in ES (and a lost create is recovered by the upsert)", async () => {
    // seeded rows were never indexed: the status update must create the full doc
    const { emails, user, senders } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    env.startWorker(okSend, 1, { search: t.index });
    await enqueueEmails(env.queue, emails, 500);

    const d = await esDoc(emails[0]!.id, (x) => x.status === "sent");
    const row = await prisma.email.findUniqueOrThrow({ where: { id: emails[0]!.id } });
    expect(d).toMatchObject({
      userId: user.id,
      senderEmail: senders[0]!.email,
      toEmail: "lead0@example.com",
      sentAt: row.sentAt!.toISOString(),
    });
  });

  it("FAILED is reflected in ES", async () => {
    const { emails } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    env.startWorker(
      async () => {
        throw new Error("SMTP 550");
      },
      1,
      { search: t.index },
    );
    await enqueueEmails(env.queue, emails, 500);
    await esDoc(emails[0]!.id, (x) => x.status === "failed");
  });

  it("a rate-limit reschedule updates scheduledAt in ES", async () => {
    await untilSafelyInsideWindow(H, 30_000);
    const window = Math.floor(Date.now() / H);
    const { emails } = await seedCampaign({ count: 2, hourlyLimit: 1 });
    const limiter = new HourlyLimiter(env.connection, {
      prefix: env.prefix,
      windowMs: H,
      perSenderCap: 0,
      globalCap: 0,
      rescheduleSpacingMs: 100,
    });
    env.startWorker(okSend, 1, { limiter, search: t.index });
    await enqueueEmails(env.queue, emails, 500);

    const moved = await esDoc(
      emails[1]!.id,
      (x) =>
        typeof x.scheduledAt === "string" &&
        Math.floor(Date.parse(x.scheduledAt) / H) === window + 1,
    );
    expect(moved.status).toBe("scheduled");
    const row = await prisma.email.findUniqueOrThrow({ where: { id: emails[1]!.id } });
    expect(moved.scheduledAt).toBe(row.scheduledAt.toISOString());
  });

  it("Elasticsearch down: the email is still SENT, the failure is logged, no crash", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { emails } = await seedCampaign({ count: 2, hourlyLimit: 10 });
    env.startWorker(okSend, 1, { search: deadIndex() });
    await enqueueEmails(env.queue, emails, 500);

    await waitFor(async () => (await prisma.email.count({ where: { status: "SENT" } })) === 2);
    await waitFor(async () => errors.mock.calls.length >= 2);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/\[search\].*failed/i);
    expect(await env.queue.getJobCounts("failed")).toEqual({ failed: 0 });
    errors.mockRestore();
  });
});
