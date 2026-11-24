import { Pool } from "pg";
import { env } from "../config/env.js";

// Plain pg pool, only used for the health check until Prisma arrives in M2.
export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });

pool.on("error", (err) => console.error("[postgres] idle client error:", err.message));
