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

  it("rejects malformed URLs", () => {
    expect(() => parseEnv({ ...valid, REDIS_URL: "not-a-url" })).toThrowError(/REDIS_URL/);
  });
});
