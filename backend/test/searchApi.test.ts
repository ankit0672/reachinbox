import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import type { EmailQueue } from "../src/queue/emailQueue.js";
import type { EmailIndex } from "../src/search/emailIndex.js";
import { loginAs, testAuthConfig } from "./helpers/auth.js";
import { resetDb, seedSenders } from "./helpers/seed.js";
import { createTestIndex, deadIndex } from "./helpers/testIndex.js";
import { createTestQueue } from "./helpers/testQueue.js";

const ok = async () => {};
const checks = { database: ok, redis: ok, elasticsearch: ok };
const ALICE = "alice@example.com";
const BOB = "bob@example.com";

let env: ReturnType<typeof createTestQueue>;
let t: Awaited<ReturnType<typeof createTestIndex>>;
// email -> session cookie (M8: real signed session cookies)
const sessions = new Map<string, string>();

function appWith(index: EmailIndex = t.index, queue: Pick<EmailQueue, "addBulk"> = env.queue) {
  return createApp(checks, {
    auth: testAuthConfig(),
    schedule: { emailQueue: queue, enqueueChunkSize: 500, search: index },
    search: { index, maxPageSize: 50 },
  });
}

function schedule(user: string, subject: string, leads: string[], app = appWith()) {
  return request(app)
    .post("/api/schedule")
    .set("Cookie", sessions.get(user)!)
    .send({
      subject,
      body: "Body text",
      startTime: new Date(Date.now() + 60_000).toISOString(),
      delayBetweenMs: 1000,
      hourlyLimit: 50,
      leads,
    });
}

function search(user: string, query: Record<string, string | number>, app = appWith()) {
  return request(app).get("/api/search").set("Cookie", sessions.get(user)!).query(query);
}

beforeEach(async () => {
  await resetDb();
  await seedSenders(3);
  env = createTestQueue();
  t = await createTestIndex();
  for (const u of [ALICE, BOB]) sessions.set(u, (await loginAs(u)).cookie);
});
afterEach(async () => {
  await env.cleanup();
  await t.cleanup();
});
afterAll(() => prisma.$disconnect());

describe("index on create", () => {
  it("indexes after the DB commit and before the jobs are enqueued", async () => {
    let rowsWhenIndexed = -1;
    const indexMany = t.index.indexMany.bind(t.index);
    vi.spyOn(t.index, "indexMany").mockImplementation(async (docs) => {
      rowsWhenIndexed = await prisma.email.count();
      return indexMany(docs);
    });
    let docsWhenEnqueued = -1;
    const queue: Pick<EmailQueue, "addBulk"> = {
      addBulk: async (jobs) => {
        docsWhenEnqueued = await t.count();
        return env.queue.addBulk(jobs);
      },
    };

    const res = await schedule(
      ALICE,
      "Launch notes",
      ["a@x.com", "b@x.com", "c@x.com"],
      appWith(t.index, queue),
    );
    expect(res.status).toBe(201);
    expect(rowsWhenIndexed).toBe(3); // committed before indexing
    expect(docsWhenEnqueued).toBe(3); // indexed before enqueueing

    const rows = await prisma.email.findMany({ include: { sender: true } });
    for (const row of rows) {
      expect(await t.get(row.id)).toMatchObject({
        id: row.id,
        userId: row.userId,
        campaignId: row.campaignId,
        toEmail: row.toEmail,
        senderEmail: row.sender.email,
        subject: "Launch notes",
        status: "scheduled",
        scheduledAt: row.scheduledAt.toISOString(),
        sentAt: null,
      });
    }
  });
});

describe("GET /api/search", () => {
  it("returns only the caller's emails: Bob can never see Alice's", async () => {
    await schedule(ALICE, "Alice roadmap", ["a1@x.com", "a2@x.com"]);
    await schedule(BOB, "Bob invoice", ["b1@x.com"]);
    await t.index.refresh();

    const alice = await search(ALICE, { q: "roadmap" });
    expect(alice.status).toBe(200);
    expect(alice.body.total).toBe(2);

    for (const q of ["roadmap", "alice", "a1@x.com", ""]) {
      const bob = await search(BOB, q ? { q } : {});
      expect(bob.body.results.every((r: { subject: string }) => r.subject === "Bob invoice")).toBe(
        true,
      );
    }
    expect((await search(BOB, { q: "roadmap" })).body.total).toBe(0);
  });

  it("filters by exact status", async () => {
    await schedule(ALICE, "Status test", ["s1@x.com", "s2@x.com", "s3@x.com"]);
    const row = await prisma.email.findFirstOrThrow({ include: { sender: true } });
    const existing = (await t.get(row.id))!;
    await t.index.upsert({
      ...existing,
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    await t.index.refresh();

    const sent = await search(ALICE, { status: "sent" });
    expect(sent.body.total).toBe(1);
    expect(sent.body.results[0].id).toBe(row.id);
    expect((await search(ALICE, { status: "scheduled" })).body.total).toBe(2);
  });

  it("paginates with {total, page, pageSize, results}", async () => {
    const leads = Array.from({ length: 25 }, (_, i) => `p${i}@x.com`);
    await schedule(ALICE, "Pagination check", leads);
    await t.index.refresh();

    const pages = await Promise.all(
      [1, 2, 3].map((page) => search(ALICE, { q: "pagination", page, pageSize: 10 })),
    );
    expect(
      pages.map((p) => [p.body.total, p.body.page, p.body.pageSize, p.body.results.length]),
    ).toEqual([
      [25, 1, 10, 10],
      [25, 2, 10, 10],
      [25, 3, 10, 5],
    ]);
    const ids = pages.flatMap((p) => p.body.results.map((r: { id: string }) => r.id));
    expect(new Set(ids).size).toBe(25);
  });

  it.each([
    [{ page: 0 }, /page/],
    [{ pageSize: 51 }, /pageSize/],
    [{ pageSize: 0 }, /pageSize/],
    [{ status: "bogus" }, /status/],
    [{ q: "x".repeat(201) }, /q/],
    [{ page: 10_000, pageSize: 50 }, /page/],
  ])("rejects invalid params %o with 400", async (query, field) => {
    const res = await search(ALICE, query as Record<string, string | number>);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toMatch(field);
  });

  it("requires a user (401 without one)", async () => {
    expect((await request(appWith()).get("/api/search")).status).toBe(401);
  });
});

describe("Elasticsearch down", () => {
  it("scheduling still works (201, rows + jobs), the failure is logged, search answers 503", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWith(deadIndex());

    const res = await schedule(ALICE, "ES is down", ["d1@x.com", "d2@x.com"], app);
    expect(res.status).toBe(201);
    expect(await prisma.email.count()).toBe(2);
    expect((await env.queue.getJobCounts("delayed")).delayed).toBe(2);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/\[search\].*index new emails.*failed/i);

    const s = await search(ALICE, { q: "down" }, app);
    expect(s.status).toBe(503);
    errors.mockRestore();
  });
});
