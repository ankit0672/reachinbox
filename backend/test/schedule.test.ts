import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { createDevUserMiddleware } from "../src/middleware/devUser.js";
import type { EmailQueue } from "../src/queue/emailQueue.js";
import type { PlanningSettings } from "../src/routes/schedule.js";
import { resetDb, seedSenders } from "./helpers/seed.js";
import { createTestQueue } from "./helpers/testQueue.js";

const ok = async () => {};
const checks = { database: ok, redis: ok, elasticsearch: ok };
const USER = "owner@example.com";

let env: ReturnType<typeof createTestQueue>;

function appWith(
  queue: Pick<EmailQueue, "addBulk"> = env.queue,
  enqueueChunkSize = 500,
  planning: Partial<PlanningSettings> = {},
) {
  return createApp(checks, { schedule: { emailQueue: queue, enqueueChunkSize, planning } });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    subject: "Quarterly update",
    body: "Hi there",
    startTime: new Date(Date.now() + 60_000).toISOString(),
    delayBetweenMs: 2000,
    hourlyLimit: 50,
    leads: ["a@example.com", "b@example.com", "c@example.com"],
    ...overrides,
  };
}

function post(body: unknown, app = appWith()) {
  return request(app)
    .post("/api/schedule")
    .set("X-Dev-User-Email", USER)
    .send(body as object);
}

beforeEach(async () => {
  await resetDb();
  await seedSenders(3);
  env = createTestQueue();
});
afterEach(() => env.cleanup());
afterAll(() => prisma.$disconnect());

describe("dev user middleware (TODO(M8): replaced by Google auth)", () => {
  it("rejects requests without X-Dev-User-Email", async () => {
    const res = await request(appWith()).post("/api/schedule").send(validBody());
    expect(res.status).toBe(401);
  });

  it("refuses to be created when NODE_ENV=production", () => {
    expect(() => createDevUserMiddleware("production")).toThrow(/production/);
  });

  it("survives concurrent first requests for a brand-new user (upsert race)", async () => {
    // Called directly (no HTTP) so the 20 upserts really overlap.
    const middleware = createDevUserMiddleware("test");
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => {
        const req = { header: () => "fresh@example.com" } as unknown as Parameters<
          typeof middleware
        >[0];
        const res = { status: () => ({ json: () => {} }) } as unknown as Parameters<
          typeof middleware
        >[1];
        return new Promise<string>((resolve) => {
          Promise.resolve(middleware(req, res, () => resolve(req.user ? "ok" : "no user"))).catch(
            (err: Error) => resolve(`error: ${err.message.split("\n").pop()}`),
          );
        });
      }),
    );
    expect(outcomes).toEqual(Array(20).fill("ok"));
    expect(await prisma.user.count({ where: { email: "fresh@example.com" } })).toBe(1);
  });

  it("recovers deterministically when it loses the user-creation race (P2002)", async () => {
    let winnerId = "";
    const spy = vi.spyOn(prisma.user, "upsert").mockImplementationOnce((async () => {
      // Another request creates the same user first, then our insert hits the unique key.
      winnerId = (
        await prisma.user.create({
          data: { googleId: "dev:racer@example.com", email: "racer@example.com", name: "racer" },
        })
      ).id;
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    }) as never);

    const middleware = createDevUserMiddleware("test");
    const req = { header: () => "racer@example.com" } as unknown as Parameters<
      typeof middleware
    >[0];
    const res = {} as Parameters<typeof middleware>[1];
    await new Promise<void>((resolve, reject) => {
      Promise.resolve(middleware(req, res, () => resolve())).catch(reject);
    });
    spy.mockRestore();
    expect(req.user?.id).toBe(winnerId);
  });

  it("upserts the user from the header", async () => {
    await post(validBody());
    await post(validBody({ subject: "again" }));
    const users = await prisma.user.findMany({ where: { email: USER } });
    expect(users).toHaveLength(1);
  });
});

describe("POST /api/schedule validation", () => {
  it.each([
    ["an empty lead list", { leads: [] }, /leads/],
    ["a missing subject", { subject: undefined }, /subject/],
    ["a blank subject", { subject: "   " }, /subject/],
    ["an oversized body", { body: "x".repeat(20_001) }, /body/],
    ["a negative delay", { delayBetweenMs: -1 }, /delayBetweenMs/],
    ["a zero hourly limit", { hourlyLimit: 0 }, /hourlyLimit/],
    ["a startTime without a timezone", { startTime: "2026-12-01T10:00:00" }, /startTime/],
  ])("rejects %s with 400", async (_name, overrides, field) => {
    const res = await post(validBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(JSON.stringify(res.body.details)).toMatch(field);
    expect(await prisma.campaign.count()).toBe(0);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(appWith())
      .post("/api/schedule")
      .set("X-Dev-User-Email", USER)
      .set("Content-Type", "application/json")
      .send('{"subject": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/);
  });

  it("rejects a request where no lead is a valid address", async () => {
    const res = await post(validBody({ leads: ["nope", "", "also@bad"] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no valid/i);
    expect(res.body.leads).toEqual({ received: 3, accepted: 0, duplicate: 0, invalid: 3 });
  });
});

describe("lead normalisation", () => {
  it("lowercases, trims, dedupes and counts accepted/duplicate/invalid", async () => {
    const res = await post(
      validBody({
        leads: ["A@Example.com", " a@example.com ", "b@example.com", "bad", "", "B@EXAMPLE.COM"],
        totalCount: 999, // client-supplied counts are ignored
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.leads).toEqual({ received: 6, accepted: 2, duplicate: 2, invalid: 2 });
    expect(res.body.invalidLeads).toEqual(["bad", ""]);

    const rows = await prisma.email.findMany({ orderBy: { scheduledAt: "asc" } });
    expect(rows.map((r) => r.toEmail)).toEqual(["a@example.com", "b@example.com"]);
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: res.body.campaignId },
    });
    expect(campaign.totalCount).toBe(2);
  });
});

describe("scheduling", () => {
  it("assigns senders round-robin in lead order", async () => {
    const leads = Array.from({ length: 7 }, (_, i) => `lead${i}@example.com`);
    const res = await post(validBody({ leads }));
    expect(res.status).toBe(201);

    const senders = await prisma.sender.findMany({ orderBy: { createdAt: "asc" } });
    const rows = await prisma.email.findMany({ orderBy: { scheduledAt: "asc" } });
    expect(rows.map((r) => r.senderId)).toEqual(
      leads.map((_, i) => senders[i % senders.length]!.id),
    );
  });

  it("sets scheduledAt = startTime + i * delayBetweenMs and one delayed job per row", async () => {
    const startTime = new Date(Date.now() + 60_000);
    const res = await post(validBody({ startTime: startTime.toISOString(), delayBetweenMs: 2500 }));
    expect(res.status).toBe(201);

    const rows = await prisma.email.findMany({ orderBy: { scheduledAt: "asc" } });
    expect(rows.map((r) => r.scheduledAt.getTime() - startTime.getTime())).toEqual([0, 2500, 5000]);
    expect(rows.every((r) => r.status === "SCHEDULED")).toBe(true);

    const jobs = await env.queue.getJobs(["delayed"]);
    expect(jobs).toHaveLength(rows.length);
    for (const row of rows) {
      const job = await env.queue.getJob(row.id);
      expect(job?.data).toEqual({ emailId: row.id });
      // delay was computed at enqueue time, so allow for the request's own duration
      const due = job!.timestamp + job!.opts.delay!;
      expect(Math.abs(due - row.scheduledAt.getTime())).toBeLessThan(1000);
    }
  });

  it("sends a past startTime as soon as possible instead of rejecting it", async () => {
    const res = await post(
      validBody({ startTime: new Date(Date.now() - 3_600_000).toISOString(), delayBetweenMs: 0 }),
    );
    expect(res.status).toBe(201);
    const counts = await env.queue.getJobCounts("waiting", "delayed");
    expect(counts).toEqual({ waiting: 3, delayed: 0 });
  });

  it("handles 1000 leads quickly: 1000 rows and 1000 jobs", async () => {
    const leads = Array.from({ length: 1000 }, (_, i) => `bulk${i}@example.com`);
    const started = Date.now();
    const res = await post(validBody({ leads, delayBetweenMs: 100 }));
    const elapsed = Date.now() - started;

    expect(res.status).toBe(201);
    expect(res.body.leads.accepted).toBe(1000);
    expect(elapsed).toBeLessThan(3000);
    expect(await prisma.email.count({ where: { campaignId: res.body.campaignId } })).toBe(1000);
    const counts = await env.queue.getJobCounts("delayed", "waiting");
    expect((counts.delayed ?? 0) + (counts.waiting ?? 0)).toBe(1000);
  }, 20_000);
});

describe("enqueue failure after commit", () => {
  it("keeps every row SCHEDULED, does not roll back, and returns a clear 503", async () => {
    let calls = 0;
    const flaky: Pick<EmailQueue, "addBulk"> = {
      addBulk: async (jobs) => {
        calls += 1;
        if (calls === 2) throw new Error("Redis connection lost");
        return env.queue.addBulk(jobs);
      },
    };
    const leads = Array.from({ length: 5 }, (_, i) => `lead${i}@example.com`);
    const res = await post(validBody({ leads }), appWith(flaky, 2));

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ campaignId: expect.any(String), queued: 2, total: 5 });
    expect(res.body.error).toMatch(/saved/i);

    const rows = await prisma.email.findMany({ where: { campaignId: res.body.campaignId } });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "SCHEDULED")).toBe(true);
    expect(await env.queue.getJobCounts("delayed")).toEqual({ delayed: 2 });
  });
});

describe("pre-packing through the API (M5)", () => {
  const H = 3_600_000;

  it("stores seq as the lead position", async () => {
    const res = await post(validBody({ delayBetweenMs: 0 }));
    const rows = await prisma.email.findMany({
      where: { campaignId: res.body.campaignId },
      orderBy: [{ scheduledAt: "asc" }, { seq: "asc" }, { id: "asc" }],
    });
    expect(rows.map((r) => [r.seq, r.toEmail])).toEqual([
      [0, "a@example.com"],
      [1, "b@example.com"],
      [2, "c@example.com"],
    ]);
  });

  it("plans a past startTime against the current window (first slot = now)", async () => {
    const before = Date.now();
    const res = await post(
      validBody({ startTime: new Date(before - 2 * H).toISOString(), delayBetweenMs: 0 }),
    );
    const rows = await prisma.email.findMany({ where: { campaignId: res.body.campaignId } });
    expect(rows.every((r) => r.scheduledAt.getTime() >= before)).toBe(true);
    expect(rows.every((r) => r.scheduledAt.getTime() <= Date.now())).toBe(true);
  });

  it("two concurrent requests never overbook a sender window", async () => {
    const app = appWith(env.queue, 500, { perSenderCap: 2 });
    const body = (tag: string) =>
      validBody({
        leads: Array.from({ length: 6 }, (_, i) => `${tag}${i}@example.com`),
        delayBetweenMs: 0,
        hourlyLimit: 50,
      });
    const [r1, r2] = await Promise.all([post(body("x"), app), post(body("y"), app)]);
    expect([r1.status, r2.status]).toEqual([201, 201]);

    const rows = await prisma.email.findMany();
    expect(rows).toHaveLength(12);
    const perSenderWindow = new Map<string, number>();
    const perSender = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.senderId}:${Math.floor(r.scheduledAt.getTime() / H)}`;
      perSenderWindow.set(k, (perSenderWindow.get(k) ?? 0) + 1);
      perSender.set(r.senderId, (perSender.get(r.senderId) ?? 0) + 1);
    }
    expect(Math.max(...perSenderWindow.values())).toBeLessThanOrEqual(2);
    expect([...perSender.values()]).toEqual([4, 4, 4]); // balanced across the 3 senders
  });

  it("returns 400 when the plan would exceed the planning horizon", async () => {
    const app = appWith(env.queue, 500, { horizonMs: 2 * H });
    const leads = Array.from({ length: 10 }, (_, i) => `h${i}@example.com`);
    const res = await post(validBody({ leads, hourlyLimit: 1, delayBetweenMs: 0 }), app);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/horizon/i);
    expect(await prisma.campaign.count()).toBe(0);
  });
});
