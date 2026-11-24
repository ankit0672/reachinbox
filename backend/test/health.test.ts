import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeInfraClients, realHealthChecks } from "../src/health/realChecks.js";

const ok = async () => {};
const fail = (msg: string) => async () => {
  throw new Error(msg);
};

describe("GET /health (injected checks)", () => {
  it("returns 200 when every dependency is up", async () => {
    const app = createApp({ database: ok, redis: ok, elasticsearch: ok });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: {
        database: { status: "ok" },
        redis: { status: "ok" },
        elasticsearch: { status: "ok" },
      },
    });
  });

  it("returns 503 and names the failing dependency", async () => {
    const app = createApp({ database: ok, redis: fail("ECONNREFUSED"), elasticsearch: ok });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.redis).toEqual({ status: "down", error: "ECONNREFUSED" });
    expect(res.body.checks.database).toEqual({ status: "ok" });
  });

  it("treats a hung dependency as down instead of hanging the request", async () => {
    const hang = () => new Promise<void>(() => {});
    const app = createApp({ database: ok, redis: ok, elasticsearch: hang }, { timeoutMs: 50 });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.elasticsearch.status).toBe("down");
    expect(res.body.checks.elasticsearch.error).toMatch(/timed out/i);
  });
});

// Needs `docker compose up -d` (Postgres, Redis, Elasticsearch) and a root .env.
describe("GET /health (real infra)", () => {
  afterAll(closeInfraClients);

  it("reports database, redis and elasticsearch as ok", async () => {
    const res = await request(createApp(realHealthChecks)).get("/health");
    expect(res.body.checks).toEqual({
      database: { status: "ok" },
      redis: { status: "ok" },
      elasticsearch: { status: "ok" },
    });
    expect(res.status).toBe(200);
  });
});
