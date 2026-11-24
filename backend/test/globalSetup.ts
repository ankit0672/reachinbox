import { execFileSync } from "node:child_process";
import pg from "pg";

// Creates the test database if needed and applies all migrations to it.
export default async function setup() {
  const testUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!testUrl.pathname.endsWith("_test")) {
    throw new Error(`Refusing to run tests against non-test database ${testUrl.pathname}`);
  }
  const dbName = testUrl.pathname.slice(1);

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "ignore",
  });
}
