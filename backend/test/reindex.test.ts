import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { reindexFromDb } from "../src/search/reindex.js";
import { resetDb, seedCampaign } from "./helpers/seed.js";
import { createTestIndex } from "./helpers/testIndex.js";

let t: Awaited<ReturnType<typeof createTestIndex>>;
beforeEach(async () => {
  await resetDb();
  t = await createTestIndex(2); // tiny chunks to exercise chunking
});
afterEach(() => t.cleanup());
afterAll(() => prisma.$disconnect());

describe("reindexFromDb", () => {
  it("rebuilds the index from Postgres with _id = email.id and current statuses", async () => {
    const { emails } = await seedCampaign({ count: 5, hourlyLimit: 10 });
    const sentAt = new Date();
    await prisma.email.update({ where: { id: emails[0]!.id }, data: { status: "SENT", sentAt } });

    expect(await reindexFromDb(t.index, 2)).toEqual({ indexed: 5, deleted: 0 });
    expect(await t.count()).toBe(5);
    expect(await t.get(emails[0]!.id)).toMatchObject({
      status: "sent",
      sentAt: sentAt.toISOString(),
    });
    expect(await t.get(emails[1]!.id)).toMatchObject({ status: "scheduled", sentAt: null });
  });

  it("is idempotent: running it twice gives the same index", async () => {
    await seedCampaign({ count: 5, hourlyLimit: 10 });
    await reindexFromDb(t.index, 2);
    expect(await reindexFromDb(t.index, 2)).toEqual({ indexed: 5, deleted: 0 });
    expect(await t.count()).toBe(5);
  });

  it("fixes stale docs and removes docs whose row no longer exists", async () => {
    const { emails } = await seedCampaign({ count: 3, hourlyLimit: 10 });
    await reindexFromDb(t.index, 2);
    const stale = (await t.get(emails[0]!.id))!;
    await t.index.upsert({ ...stale, status: "failed" }); // drifted
    await t.index.upsert({ ...stale, id: "00000000-0000-0000-0000-00000000dead" }); // orphan
    await prisma.email.delete({ where: { id: emails[2]!.id } }); // row deleted -> doc orphaned

    expect(await reindexFromDb(t.index, 2)).toEqual({ indexed: 2, deleted: 2 });
    expect(await t.count()).toBe(2);
    expect((await t.get(emails[0]!.id))?.status).toBe("scheduled");
    expect(await t.get(emails[2]!.id)).toBeNull();
  });
});
