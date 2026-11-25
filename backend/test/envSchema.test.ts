import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/envSchema.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5434/db",
  REDIS_URL: "redis://localhost:6380",
  ELASTICSEARCH_URL: "http://localhost:9200",
};

describe("parseEnv", () => {
  it("applies defaults for optional values", () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
    expect(env.FRONTEND_URL).toBe("http://localhost:5173");
  });

  it("coerces numeric strings from .env into numbers", () => {
    expect(parseEnv({ ...valid, API_PORT: "4100" }).API_PORT).toBe(4100);
  });

  it("fails fast and names every missing required variable", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL[\s\S]*REDIS_URL[\s\S]*ELASTICSEARCH_URL/);
  });

  it("defaults the sender pool to 3 and rejects a non-positive size", () => {
    expect(parseEnv(valid).SENDER_POOL_SIZE).toBe(3);
    expect(parseEnv({ ...valid, SENDER_POOL_SIZE: "5" }).SENDER_POOL_SIZE).toBe(5);
    expect(() => parseEnv({ ...valid, SENDER_POOL_SIZE: "0" })).toThrowError(/SENDER_POOL_SIZE/);
  });

  it("reads queue settings with sensible defaults", () => {
    const env = parseEnv(valid);
    expect(env.WORKER_CONCURRENCY).toBe(5);
    expect(env.BULLMQ_PREFIX).toBe("reachinbox");
    expect(env.EMAIL_JOB_ATTEMPTS).toBe(3);
    expect(env.EMAIL_JOB_BACKOFF_MS).toBe(5000);
    expect(parseEnv({ ...valid, WORKER_CONCURRENCY: "10" }).WORKER_CONCURRENCY).toBe(10);
    expect(() => parseEnv({ ...valid, WORKER_CONCURRENCY: "0" })).toThrowError(
      /WORKER_CONCURRENCY/,
    );
  });

  it("reads rate-limit settings, where 0 means 'off' for every cap", () => {
    const env = parseEnv(valid);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(3_600_000);
    expect(env.MAX_EMAILS_PER_HOUR_PER_SENDER).toBe(100);
    expect(env.MAX_EMAILS_PER_HOUR).toBe(0);
    expect(env.MIN_DELAY_BETWEEN_SENDS_MS).toBe(2000);
    expect(env.PLANNING_HORIZON_DAYS).toBe(30);
    const off = parseEnv({
      ...valid,
      MAX_EMAILS_PER_HOUR_PER_SENDER: "0",
      MAX_EMAILS_PER_HOUR: "0",
      MIN_DELAY_BETWEEN_SENDS_MS: "0",
    });
    expect([
      off.MAX_EMAILS_PER_HOUR_PER_SENDER,
      off.MAX_EMAILS_PER_HOUR,
      off.MIN_DELAY_BETWEEN_SENDS_MS,
    ]).toEqual([0, 0, 0]);
    expect(() => parseEnv({ ...valid, MAX_EMAILS_PER_HOUR: "-1" })).toThrowError(
      /MAX_EMAILS_PER_HOUR/,
    );
    expect(() => parseEnv({ ...valid, RATE_LIMIT_WINDOW_MS: "0" })).toThrowError(
      /RATE_LIMIT_WINDOW_MS/,
    );
  });

  it("reads reconcile and SMTP timeout settings", () => {
    const env = parseEnv(valid);
    expect(env.STALE_PROCESSING_MS).toBe(600_000);
    expect(env.RECONCILE_CHUNK_SIZE).toBe(500);
    expect(env.RECONCILE_LOCK_MS).toBe(60_000);
    expect(env.SMTP_TIMEOUT_MS).toBe(30_000);
  });

  it("rejects a stale threshold that is not safely above the SMTP timeout", () => {
    expect(() =>
      parseEnv({ ...valid, SMTP_TIMEOUT_MS: "60000", STALE_PROCESSING_MS: "120000" }),
    ).toThrowError(/STALE_PROCESSING_MS/);
  });

  it("rejects malformed URLs", () => {
    expect(() => parseEnv({ ...valid, REDIS_URL: "not-a-url" })).toThrowError(/REDIS_URL/);
  });
});
