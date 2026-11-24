import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });

// Tests never touch the dev database: same Postgres, database name + "_test".
const devUrl = new URL(process.env.DATABASE_URL ?? "");
const testUrl = new URL(devUrl);
testUrl.pathname = `${devUrl.pathname}_test`;
// Set here too so globalSetup (main process) sees the test URL, not the dev one.
process.env.DATABASE_URL = testUrl.toString();

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/globalSetup.ts"],
    env: { NODE_ENV: "test", DATABASE_URL: testUrl.toString() },
    // Test files share one database; run them one at a time.
    fileParallelism: false,
  },
});
