import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { loginAs, testAuthConfig } from "./helpers/auth.js";
import { resetDb, seedSenders } from "./helpers/seed.js";

const ok = async () => {};
const app = () =>
  createApp({ database: ok, redis: ok, elasticsearch: ok }, { auth: testAuthConfig() });

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

describe("GET /api/senders", () => {
  it("requires a session", async () => {
    expect((await request(app()).get("/api/senders")).status).toBe(401);
  });

  it("returns only the size of the sender pool: no addresses, no credentials", async () => {
    await seedSenders(3);
    const { cookie } = await loginAs("owner@example.com");
    const res = await request(app()).get("/api/senders").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
  });

  it("returns 0 before the pool exists", async () => {
    const { cookie } = await loginAs("owner@example.com");
    const res = await request(app()).get("/api/senders").set("Cookie", cookie);
    expect(res.body).toEqual({ count: 0 });
  });
});
