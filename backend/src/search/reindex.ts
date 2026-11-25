import { prisma } from "../db/prisma.js";
import { toEmailDoc, type EmailIndex } from "./emailIndex.js";

/**
 * Rebuilds the search index from Postgres: every row is (re)indexed with
 * _id = email.id, then any document whose row no longer exists is deleted.
 * Overwrites are idempotent, so running it twice is harmless. Orphans are
 * found by walking the index and checking ids against the DB, which is safe
 * while new campaigns are being scheduled (their rows exist before their docs).
 */
export async function reindexFromDb(
  index: EmailIndex,
  chunkSize: number,
): Promise<{ indexed: number; deleted: number }> {
  await index.ensureIndex();

  let indexed = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.email.findMany({
      include: { sender: { select: { email: true } } },
      orderBy: { id: "asc" },
      take: chunkSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    await index.indexMany(rows.map(toEmailDoc));
    indexed += rows.length;
  }

  await index.refresh();
  let deleted = 0;
  for await (const ids of index.scanIds(chunkSize)) {
    const existing = await prisma.email.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const keep = new Set(existing.map((e) => e.id));
    const orphans = ids.filter((id) => !keep.has(id));
    await index.deleteMany(orphans);
    deleted += orphans.length;
  }
  await index.refresh();
  return { indexed, deleted };
}
