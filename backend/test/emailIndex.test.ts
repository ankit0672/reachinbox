import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_INDEX_MAPPING, type EmailDoc } from "../src/search/emailIndex.js";
import { createTestIndex } from "./helpers/testIndex.js";

let t: Awaited<ReturnType<typeof createTestIndex>>;
beforeEach(async () => {
  t = await createTestIndex();
});
afterEach(() => t.cleanup());

const doc = (over: Partial<EmailDoc> = {}): EmailDoc => ({
  id: crypto.randomUUID(),
  userId: "user-a",
  campaignId: "camp-1",
  toEmail: "lead1@example.com",
  senderEmail: "sender1@ethereal.email",
  subject: "Quarterly roadmap update",
  body: "Hello there",
  status: "scheduled",
  scheduledAt: "2026-12-01T10:00:00.000Z",
  sentAt: null,
  ...over,
});

describe("EmailIndex mapping and ensureIndex", () => {
  it("creates the index with the explicit mapping", async () => {
    const mapping = await t.client.indices.getMapping({ index: t.name });
    const props = mapping[t.name]!.mappings.properties!;
    for (const f of ["id", "userId", "campaignId", "status", "toEmail", "senderEmail"]) {
      expect(props[f]?.type).toBe("keyword");
    }
    for (const f of ["subject", "body"]) expect(props[f]?.type).toBe("text");
    for (const f of ["scheduledAt", "sentAt"]) expect(props[f]?.type).toBe("date");
    expect(mapping[t.name]!.mappings.dynamic).toBe(EMAIL_INDEX_MAPPING.dynamic);
  });

  it("is idempotent: a second ensureIndex is a no-op", async () => {
    expect(await t.index.ensureIndex()).toBe("exists");
    expect(await t.index.ensureIndex()).toBe("exists");
  });
});

describe("EmailIndex writes", () => {
  it("indexMany writes every doc in chunks, with _id = email id", async () => {
    const small = await createTestIndex(2);
    const docs = Array.from({ length: 5 }, (_, i) => doc({ toEmail: `l${i}@example.com` }));
    await small.index.indexMany(docs);
    expect(await small.count()).toBe(5);
    expect((await small.get(docs[3]!.id))?.toEmail).toBe("l3@example.com");
    await small.cleanup();
  });

  it("upsert creates a full doc when the original create was lost (doc_as_upsert)", async () => {
    const d = doc({ status: "sent", sentAt: "2026-12-01T10:00:05.000Z" });
    await t.index.upsert(d);
    expect(await t.get(d.id)).toMatchObject({
      userId: "user-a",
      status: "sent",
      subject: d.subject,
    });
  });

  it("upsert updates an existing doc in place", async () => {
    const d = doc();
    await t.index.indexMany([d]);
    await t.index.upsert({ ...d, status: "sent", sentAt: "2026-12-01T10:00:05.000Z" });
    expect(await t.get(d.id)).toMatchObject({ status: "sent", sentAt: "2026-12-01T10:00:05.000Z" });
    expect(await t.count()).toBe(1);
  });
});

describe("EmailIndex search", () => {
  beforeEach(async () => {
    await t.index.indexMany([
      doc({ subject: "Roadmap for Q1", toEmail: "ana@acme.com" }),
      doc({ subject: "Invoice reminder", status: "sent", toEmail: "bo@acme.com" }),
      doc({ subject: "Roadmap follow-up", status: "sent" }),
      doc({ userId: "user-b", subject: "Roadmap secret plan" }),
    ]);
    await t.index.refresh();
  });

  it("is always scoped to the given user", async () => {
    const a = await t.index.search({ userId: "user-a", q: "roadmap", page: 1, pageSize: 10 });
    expect(a.total).toBe(2);
    expect(a.results.every((r) => r.userId === "user-a")).toBe(true);
    const b = await t.index.search({ userId: "user-b", q: "invoice", page: 1, pageSize: 10 });
    expect(b.total).toBe(0);
  });

  it("matches subject, body and toEmail; status is an exact filter", async () => {
    expect(
      (await t.index.search({ userId: "user-a", q: "ana", page: 1, pageSize: 10 })).total,
    ).toBe(1);
    expect(
      (await t.index.search({ userId: "user-a", q: "hello", page: 1, pageSize: 10 })).total,
    ).toBe(3);
    const sent = await t.index.search({ userId: "user-a", status: "sent", page: 1, pageSize: 10 });
    expect(sent.total).toBe(2);
    expect(sent.results.every((r) => r.status === "sent")).toBe(true);
  });
});
