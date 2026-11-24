import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { HourlyLimiter, type LimiterConfig } from "../src/rateLimit/hourlyLimiter.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const H = 3_600_000;
const NOW = 500_000 * H + 60_000; // fixed clock: 1 minute into window 500000

const admin = new Redis(REDIS_URL);
let prefix: string;

beforeEach(() => {
  prefix = `reachinbox-test-${randomUUID()}`;
});

afterAll(async () => {
  const keys = await admin.keys("reachinbox-test-*:rl:*");
  const rs = await admin.keys("reachinbox-test-*:rs:*");
  if (keys.length + rs.length) await admin.del(...keys, ...rs);
  await admin.quit();
});

function limiter(conn: Redis, overrides: Partial<LimiterConfig> = {}) {
  return new HourlyLimiter(conn, {
    prefix,
    windowMs: H,
    perSenderCap: 0,
    globalCap: 0,
    rescheduleSpacingMs: 1000,
    now: () => NOW,
    ...overrides,
  });
}
const job = { campaignId: "c1", senderId: "s1", campaignLimit: 3 };

describe("HourlyLimiter (Lua, atomic)", () => {
  it("50 concurrent acquires from 10 connections allow exactly the limit", async () => {
    const conns = Array.from({ length: 10 }, () => new Redis(REDIS_URL));
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => limiter(conns[i % 10]!).acquire(job)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(await admin.get(`${prefix}:rl:cs:c1:s1:500000`)).toBe("3");
    await Promise.all(conns.map((c) => c.quit()));
  });

  it("the most restrictive cap wins and is reported", async () => {
    const l = limiter(admin, { perSenderCap: 2, globalCap: 5 });
    expect((await l.acquire({ ...job, campaignLimit: 10 })).allowed).toBe(true);
    expect((await l.acquire({ ...job, campaignLimit: 10 })).allowed).toBe(true);
    expect(await l.acquire({ ...job, campaignLimit: 10 })).toMatchObject({
      allowed: false,
      blockedBy: "sender",
      limit: 2,
    });
    // another sender is not blocked by s1's cap, but the global cap (5) still counts it
    const g = limiter(admin, { globalCap: 3 });
    expect((await g.acquire({ ...job, senderId: "s2", campaignLimit: 10 })).allowed).toBe(true);
    expect(await g.acquire({ ...job, senderId: "s3", campaignLimit: 10 })).toMatchObject({
      allowed: false,
      blockedBy: "global",
    });
    expect(await limiter(admin).acquire({ ...job, campaignLimit: 2 })).toMatchObject({
      allowed: false,
      blockedBy: "campaign",
    });
  });

  it("a blocked acquire increments nothing", async () => {
    const l = limiter(admin, { perSenderCap: 1 });
    await l.acquire(job);
    await l.acquire(job); // blocked by sender cap
    expect(await admin.get(`${prefix}:rl:cs:c1:s1:500000`)).toBe("1");
    expect(await admin.get(`${prefix}:rl:s:s1:500000`)).toBe("1");
    expect(await admin.get(`${prefix}:rl:g:500000`)).toBe("1");
  });

  it("treats 0 as no cap for the sender and global caps", async () => {
    const l = limiter(admin);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => l.acquire({ ...job, campaignLimit: 100 })),
    );
    expect(results.every((r) => r.allowed)).toBe(true);
  });

  it("sets a TTL of two windows on the counters", async () => {
    await limiter(admin).acquire(job);
    const ttl = await admin.ttl(`${prefix}:rl:s:s1:500000`);
    expect(ttl).toBeGreaterThan(7000);
    expect(ttl).toBeLessThanOrEqual(7200);
  });

  it("refunds exactly the keys it incremented, even after the clock moved to a new window", async () => {
    let now = NOW;
    const l = limiter(admin, { now: () => now });
    const acquired = await l.acquire(job);
    if (!acquired.allowed) throw new Error("expected allowed");

    now = NOW + H; // the SMTP attempt failed an hour later
    await l.acquire({ ...job, campaignId: "c2" }); // something counted in the new window
    await l.refund(acquired.keys);

    expect(await admin.get(`${prefix}:rl:cs:c1:s1:500000`)).toBe("0");
    expect(await admin.get(`${prefix}:rl:s:s1:500000`)).toBe("0");
    expect(await admin.get(`${prefix}:rl:s:s1:500001`)).toBe("1"); // untouched
  });

  it("never drives a counter negative or recreates an expired key on refund", async () => {
    await limiter(admin).refund([`${prefix}:rl:s:ghost:1`]);
    expect(await admin.exists(`${prefix}:rl:s:ghost:1`)).toBe(0);
  });

  it("hands out ordered reschedule slots in the next window", async () => {
    const l = limiter(admin, { rescheduleSpacingMs: 250 });
    const slots = [await l.nextSlot("s1", 500000), await l.nextSlot("s1", 500000)];
    expect(slots.map((d) => d.getTime() - 500_001 * H)).toEqual([0, 250]);
  });

  it("supports shorter windows (RATE_LIMIT_WINDOW_MS) with the same epoch math", async () => {
    const windowMs = 2000;
    const l = limiter(admin, { windowMs, now: () => 1_000_000 * windowMs + 5 });
    await l.acquire(job);
    expect(await admin.get(`${prefix}:rl:s:s1:1000000`)).toBe("1");
  });
});
