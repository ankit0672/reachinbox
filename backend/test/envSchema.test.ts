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

  it("rejects malformed URLs", () => {
    expect(() => parseEnv({ ...valid, REDIS_URL: "not-a-url" })).toThrowError(/REDIS_URL/);
  });
});
