import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueEmails } from "../src/queue/emailQueue.js";
import { resetDb, seedCampaign } from "./helpers/seed.js";
import { createTestQueue, untilSafelyInsideWindow, waitFor } from "./helpers/testQueue.js";

const H = 3_600_000;
const FIXTURE = path.resolve(import.meta.dirname, "fixtures/limitedWorker.ts");

let env: ReturnType<typeof createTestQueue>;
let children: ChildProcess[] = [];

function startWorkerProcess(prefix: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", FIXTURE], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, TEST_PREFIX: prefix, TEST_WINDOW_MS: String(H) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.stdout!.on("data", (d: Buffer) => d.toString().includes("READY") && resolve(child));
    child.on("exit", (code) => reject(new Error(`worker process exited early (${code})`)));
  });
}

beforeEach(async () => {
  await resetDb();
  env = createTestQueue();
});
afterEach(async () => {
  await Promise.all(
    children.map((c) => new Promise((r) => (c.once("exit", r), c.kill("SIGTERM")))),
  );
  children = [];
  await env.cleanup();
});
afterAll(() => prisma.$disconnect());

it("two worker PROCESSES racing: 20 due emails, limit 5 -> exactly 5 sends, counter never above 5", async () => {
  await untilSafelyInsideWindow(H, 60_000);
  const window = Math.floor(Date.now() / H);
  const { campaign, emails, senders } = await seedCampaign({ count: 20, hourlyLimit: 5 });
  const [a, b] = await Promise.all([
    startWorkerProcess(env.prefix),
    startWorkerProcess(env.prefix),
  ]);

  const counterKey = `${env.prefix}:rl:cs:${campaign.id}:${senders[0]!.id}:${window}`;
  let maxCounter = 0;
  await enqueueEmails(env.queue, emails, 500);

  await waitFor(async () => {
    maxCounter = Math.max(maxCounter, Number((await env.connection.get(counterKey)) ?? 0));
    const counts = await env.queue.getJobCounts("waiting", "active", "delayed");
    return counts.waiting === 0 && counts.active === 0 && counts.delayed === 15;
  }, 20_000);

  const sends = await env.connection.lrange(`${env.prefix}:test:sent`, 0, -1);
  const pids = await env.connection.smembers(`${env.prefix}:test:pids`);
  const final = await prisma.email.findMany({ where: { campaignId: campaign.id } });

  expect(pids.sort()).toEqual([String(a.pid), String(b.pid)].sort()); // both really competed
  expect(sends).toHaveLength(5);
  expect(maxCounter).toBe(5);
  expect(await env.connection.get(counterKey)).toBe("5");
  expect(final.filter((e) => e.status === "SENT")).toHaveLength(5);
  const moved = final.filter((e) => e.status === "SCHEDULED");
  expect(moved).toHaveLength(15);
  expect(moved.every((e) => Math.floor(e.scheduledAt.getTime() / H) === window + 1)).toBe(true);
  expect(await env.queue.getJobCounts("failed")).toEqual({ failed: 0 });
}, 30_000);
