import { pool } from "../db/pool.js";
import { redis } from "../redis/connection.js";
import { esClient } from "../search/client.js";
import type { HealthChecks } from "../routes/health.js";

export const realHealthChecks: HealthChecks = {
  database: async () => {
    await pool.query("SELECT 1");
  },
  redis: async () => {
    await redis.ping();
  },
  elasticsearch: async () => {
    if (!(await esClient.ping())) throw new Error("ping returned false");
  },
};

export async function closeInfraClients(): Promise<void> {
  await Promise.allSettled([pool.end(), redis.quit(), esClient.close()]);
}
