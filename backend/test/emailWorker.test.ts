import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueEmail } from "../src/queue/emailQueue.js";
import { messageIdFor, processEmail, type SendFn } from "../src/queue/emailWorker.js";
import { getEmail, resetDb, seedEmail } from "./helpers/seed.js";
import { createTestQueue, waitFor } from "./helpers/testQueue.js";

// Fake SMTP: echoes the Message-ID it was given, like a real server would keep it.
function fakeSend(delayMs = 0) {
  return vi.fn<SendFn>(async (_sender, mail) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return {
      messageId: mail.messageId ?? "<none>",
      previewUrl: "https://ethereal.email/message/x",
    };
  });
}

let env: ReturnType<typeof createTestQueue>;
const extraEnvs: ReturnType<typeof createTestQueue>[] = [];

beforeEach(async () => {
  await resetDb();
  env = createTestQueue();
});

afterEach(async () => {
  await Promise.all([env, ...extraEnvs.splice(0)].map((e) => e.cleanup()));
});

afterAll(() => prisma.$disconnect());

describe("delayed send", () => {
  it("does not send before the delay and marks the row SENT after ~5s", async () => {
    const send = fakeSend();
    env.startWorker(send);
    const email = await seedEmail({ scheduledAt: new Date(Date.now() + 5000) });
    await enqueueEmail(env.queue, email);

    await new Promise((r) => setTimeout(r, 4000));
    expect((await getEmail(email.id)).status).toBe("SCHEDULED");
    expect(send).not.toHaveBeenCalled();

    const sent = await waitFor(async () => {
      const row = await getEmail(email.id);
      return row.status === "SENT" ? row : null;
    }, 6000);
    // Never early, and on time: within 1.5s of scheduledAt.
    const lateByMs = sent.sentAt!.getTime() - email.scheduledAt.getTime();
    expect(lateByMs).toBeGreaterThanOrEqual(0);
    expect(lateByMs).toBeLessThan(1500);
    expect(sent.attempts).toBe(1);
    expect(sent.previewUrl).toBe("https://ethereal.email/message/x");
    expect(send).toHaveBeenCalledTimes(1);
  }, 15_000);
});

describe("deterministic Message-ID", () => {
  it("derives the Message-ID from email.id and the sender's domain, and stores it", async () => {
    const send = fakeSend();
    env.startWorker(send);
    const email = await seedEmail();
    await enqueueEmail(env.queue, email);

    await waitFor(async () => (await getEmail(email.id)).status === "SENT");
    const expected = `<${email.id}@ethereal.test>`;
    expect(messageIdFor(email.id, "sender1@ethereal.test")).toBe(expected);
    expect(send.mock.calls[0]?.[1].messageId).toBe(expected);
    expect((await getEmail(email.id)).messageId).toBe(expected);
  });
});

describe("idempotency", () => {
  it("adding the same jobId twice creates one job and one send", async () => {
    const email = await seedEmail({ scheduledAt: new Date(Date.now() + 1000) });
    const first = await enqueueEmail(env.queue, email);
    const second = await enqueueEmail(env.queue, email);

    expect(first.id).toBe(email.id);
    expect(second.id).toBe(email.id);
    const counts = await env.queue.getJobCounts("delayed", "waiting", "active");
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(1);

    const send = fakeSend();
    env.startWorker(send);
    await waitFor(async () => (await getEmail(email.id)).status === "SENT");
    await new Promise((r) => setTimeout(r, 500)); // give a phantom second job time to show up
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("two processors racing on the same row: exactly one claims and sends", async () => {
    const email = await seedEmail();
    const send = fakeSend(100);
    const deps = { send, isFinalAttempt: false };

    const results = await Promise.all([processEmail(email.id, deps), processEmail(email.id, deps)]);

    expect(results.sort()).toEqual(["sent", "skipped"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await getEmail(email.id)).status).toBe("SENT");
  });

  it("two workers on separate queues holding a job for the same row: one send", async () => {
    // e.g. a stale job plus a reconcile-created one. jobId can't dedupe across
    // queues, so only the DB claim stands between this and a double send.
    const email = await seedEmail();
    const other = createTestQueue();
    extraEnvs.push(other);
    const send = fakeSend(100);
    env.startWorker(send);
    other.startWorker(send);

    await Promise.all([enqueueEmail(env.queue, email), enqueueEmail(other.queue, email)]);
    await waitFor(async () => (await getEmail(email.id)).status === "SENT");
    await waitFor(async () => {
      const [a, b] = await Promise.all([
        env.queue.getJobCounts("completed"),
        other.queue.getJobCounts("completed"),
      ]);
      return (a.completed ?? 0) + (b.completed ?? 0) === 2;
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a row that is not SCHEDULED is never sent", async () => {
    const email = await seedEmail({ status: "SENT" });
    const send = fakeSend();
    expect(await processEmail(email.id, { send, isFinalAttempt: false })).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("SMTP failure path", () => {
  it("increments attempts, retries, and marks FAILED only after the last attempt", async () => {
    const statusSeenBySend: string[] = [];
    const send = vi.fn<SendFn>(async () => {
      throw new Error("SMTP 421 service not available");
    });
    const email = await seedEmail();
    // Record the row as the worker sees it on each attempt.
    send.mockImplementation(async () => {
      const row = await getEmail(email.id);
      statusSeenBySend.push(`${row.status}#${row.attempts}`);
      throw new Error("SMTP 421 service not available");
    });

    env.startWorker(send);
    await enqueueEmail(env.queue, email);

    const failed = await waitFor(async () => {
      const row = await getEmail(email.id);
      return row.status === "FAILED" ? row : null;
    });
    // Each retry had to re-win the claim, so the row went back to SCHEDULED in between.
    expect(statusSeenBySend).toEqual(["PROCESSING#1", "PROCESSING#2", "PROCESSING#3"]);
    expect(failed.attempts).toBe(3);
    expect(failed.errorMessage).toMatch(/SMTP 421/);
    expect(failed.sentAt).toBeNull();

    const job = await env.queue.getJob(email.id);
    expect(await job?.getState()).toBe("failed"); // kept, not removed (removeOnFail: false)
  });

  it("recovers if a later attempt succeeds", async () => {
    const email = await seedEmail();
    const send = fakeSend();
    send.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    env.startWorker(send);
    await enqueueEmail(env.queue, email);

    const sent = await waitFor(async () => {
      const row = await getEmail(email.id);
      return row.status === "SENT" ? row : null;
    });
    expect(sent.attempts).toBe(2);
    expect(sent.errorMessage).toBeNull();
  });
});
