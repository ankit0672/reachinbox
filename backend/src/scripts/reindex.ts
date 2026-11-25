// npm run reindex: rebuild the Elasticsearch index from Postgres (idempotent).
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { emailIndex, esClient } from "../search/client.js";
import { reindexFromDb } from "../search/reindex.js";

const started = Date.now();
const { indexed, deleted } = await reindexFromDb(emailIndex, env.ES_BULK_CHUNK_SIZE);
console.log(
  `[reindex] ${emailIndex.name}: indexed ${indexed} emails from Postgres, removed ${deleted} orphaned docs (${Date.now() - started}ms)`,
);
await Promise.all([prisma.$disconnect(), esClient.close()]);
