import path from "node:path";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

// Same single root .env as the app; real env vars (e.g. the test DB URL) win.
dotenv.config({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
