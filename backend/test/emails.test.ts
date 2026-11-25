import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import type { EmailStatus } from "../src/generated/prisma/client.js";
import { loginAs, testAuthConfig } from "./helpers/auth.js";
import { resetDb, seedSenders } from "./helpers/seed.js";

const ok = async () => {};
const app = () =>
  createApp(
    { database: ok, redis: ok, elasticsearch: ok },
    { auth: testAuthConfig(), emails: { maxPageSize: 50 } },
  );

const T = (min: number) => new Date(Date.UTC(2026, 11, 1, 10, min));
let alice: Awaited<ReturnType<typeof loginAs>>;
let bob: Awaited<ReturnType<typeof loginAs>>;

type Row = {
  to: string;
  status: EmailStatus;
  scheduledAt: Date;
  seq: number;
  sentAt?: Date;
  failedAt?: Date;
  previewUrl?: string;
  body?: string;
  errorMessage?: string;
};

async function seedRows(userId: string, rows: Row[]) {
  const [sender] = await prisma.sender.findMany();
  const campaign = await prisma.campaign.create({
    data: {
      userId,
      subject: "S",
      body: "B",
      startTime: T(0),
      delayBetweenMs: 0,
      hourlyLimit: 10,
      totalCount: rows.length,
    },
  });
  for (const r of rows) {
    await prisma.email.create({
      data: {
        campaignId: campaign.id,
        userId,
        senderId: sender!.id,
        seq: r.seq,
        toEmail: r.to,
        subject: `Subject ${r.to}`,
        body: r.body ?? "B",
        scheduledAt: r.scheduledAt,
        errorMessage: r.errorMessage,
        status: r.status,
        sentAt: r.sentAt,
        failedAt: r.failedAt,
        previewUrl: r.previewUrl,
        ...(r.status === "SENT" ? { messageId: `<${r.to}>` } : {}),
      },
    });
  }
}

const get = (cookie: string, query: Record<string, string | number> = {}) =>
  request(app()).get("/api/emails").set("Cookie", cookie).query(query);

beforeEach(async () => {
  await resetDb();
  await seedSenders(1);
  alice = await loginAs("alice@example.com");
  bob = await loginAs("bob@example.com");
  await seedRows(alice.user.id, [
    { to: "a-late@x.com", status: "SCHEDULED", scheduledAt: T(30), seq: 0 },
    { to: "a-tie-seq2@x.com", status: "SCHEDULED", scheduledAt: T(10), seq: 2 },
    { to: "a-tie-seq1@x.com", status: "PROCESSING", scheduledAt: T(10), seq: 1 },
    {
      to: "a-sent-old@x.com",
      status: "SENT",
      scheduledAt: T(1),
      seq: 3,
      sentAt: T(2),
      previewUrl: "https://ethereal.email/message/old",
    },
    {
      to: "a-failed@x.com",
      status: "FAILED",
      scheduledAt: T(3),
      seq: 4,
      failedAt: T(5),
      errorMessage: "SMTP 421 service not available",
    },
    {
      to: "a-sent-new@x.com",
      status: "SENT",
      scheduledAt: T(4),
      seq: 5,
      sentAt: T(8),
      previewUrl: "https://ethereal.email/message/new",
    },
  ]);
  await seedRows(bob.user.id, [
    { to: "b-sched@x.com", status: "SCHEDULED", scheduledAt: T(0), seq: 0 },
    {
      to: "b-sent@x.com",
      status: "SENT",
      scheduledAt: T(0),
      seq: 1,
      sentAt: T(1),
      previewUrl: "https://ethereal.email/message/bob",
    },
  ]);
});
afterAll(() => prisma.$disconnect());

describe("GET /api/emails", () => {
  it("scheduled: SCHEDULED + PROCESSING rows ordered by (scheduledAt, seq, id)", async () => {
    const res = await get(alice.cookie, { status: "scheduled" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    expect(
      res.body.results.map((r: { toEmail: string; status: string }) => `${r.toEmail}:${r.status}`),
    ).toEqual([
      "a-tie-seq1@x.com:processing",
      "a-tie-seq2@x.com:scheduled",
      "a-late@x.com:scheduled",
    ]);
  });

  it("sent: SENT + FAILED rows, newest first (failure time for FAILED), previewUrl only on sent", async () => {
    const res = await get(alice.cookie, { status: "sent" });
    expect(res.body.total).toBe(3);
    expect(res.body.results).toEqual([
      {
        id: expect.any(String),
        toEmail: "a-sent-new@x.com",
        subject: "Subject a-sent-new@x.com",
        status: "sent",
        scheduledAt: T(4).toISOString(),
        sentAt: T(8).toISOString(),
        previewUrl: "https://ethereal.email/message/new",
        bodyPreview: "B",
        errorMessage: null,
      },
      {
        id: expect.any(String),
        toEmail: "a-failed@x.com",
        subject: "Subject a-failed@x.com",
        status: "failed",
        scheduledAt: T(3).toISOString(),
        sentAt: null,
        previewUrl: null,
        bodyPreview: "B",
        errorMessage: "SMTP 421 service not available",
      },
      {
        id: expect.any(String),
        toEmail: "a-sent-old@x.com",
        subject: "Subject a-sent-old@x.com",
        status: "sent",
        scheduledAt: T(1).toISOString(),
        sentAt: T(2).toISOString(),
        previewUrl: "https://ethereal.email/message/old",
        bodyPreview: "B",
        errorMessage: null,
      },
    ]);
  });

  it("bodyPreview: whitespace collapsed, cut to 120 characters with an ellipsis", async () => {
    const long = `Hi   there,\n\n\tthis is   line two. ${"word ".repeat(60)}`;
    await seedRows(bob.user.id, [
      { to: "b-long@x.com", status: "SCHEDULED", scheduledAt: T(50), seq: 2, body: long },
      {
        to: "b-short@x.com",
        status: "SCHEDULED",
        scheduledAt: T(51),
        seq: 3,
        body: "  Short\n body ",
      },
    ]);
    const res = await get(bob.cookie, { status: "scheduled" });
    const byTo = Object.fromEntries(
      res.body.results.map((r: { toEmail: string; bodyPreview: string }) => [
        r.toEmail,
        r.bodyPreview,
      ]),
    );
    expect(byTo["b-short@x.com"]).toBe("Short body");
    const preview: string = byTo["b-long@x.com"];
    expect(preview.startsWith("Hi there, this is line two. word word")).toBe(true);
    expect(preview).not.toMatch(/\s{2,}|[\n\t]/);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(121);
  });

  it("errorMessage is only returned for FAILED rows", async () => {
    await seedRows(bob.user.id, [
      {
        to: "b-retrying@x.com",
        status: "SCHEDULED",
        scheduledAt: T(52),
        seq: 4,
        errorMessage: "ETIMEDOUT (attempt 1)",
      },
    ]);
    const res = await get(bob.cookie, { status: "scheduled" });
    const row = res.body.results.find((r: { toEmail: string }) => r.toEmail === "b-retrying@x.com");
    expect(row.errorMessage).toBeNull();
  });

  it("is strictly scoped to the signed-in user", async () => {
    for (const status of ["scheduled", "sent"]) {
      const b = await get(bob.cookie, { status });
      expect(b.body.total).toBe(1);
      expect(b.body.results.every((r: { toEmail: string }) => r.toEmail.startsWith("b-"))).toBe(
        true,
      );
      const a = await get(alice.cookie, { status });
      expect(a.body.results.some((r: { toEmail: string }) => r.toEmail.startsWith("b-"))).toBe(
        false,
      );
    }
  });

  it("defaults to status=scheduled and paginates", async () => {
    const p1 = await get(alice.cookie, { pageSize: 2 });
    const p2 = await get(alice.cookie, { pageSize: 2, page: 2 });
    expect([p1.body.total, p1.body.results.length, p2.body.results.length]).toEqual([3, 2, 1]);
    expect(p2.body.results[0].toEmail).toBe("a-late@x.com");
    expect((await get(alice.cookie, { page: 9 })).body.results).toEqual([]);
  });

  it.each([
    [{ status: "processing" }, /status/],
    [{ status: "bogus" }, /status/],
    [{ page: 0 }, /page/],
    [{ pageSize: 51 }, /pageSize/],
    [{ pageSize: "abc" }, /pageSize/],
  ])("rejects %o with 400", async (query, field) => {
    const res = await get(alice.cookie, query as Record<string, string | number>);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toMatch(field);
  });
});
