import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createTestQueue } from "./helpers/testQueue.js";

const ok = async () => {};
const checks = { database: ok, redis: ok, elasticsearch: ok };
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

let env: ReturnType<typeof createTestQueue>;
beforeEach(() => {
  env = createTestQueue();
});
afterEach(() => env.cleanup());

function appWith(user: string | undefined, pass: string | undefined, nodeEnv = "development") {
  return createApp(checks, { bullBoard: { queue: env.queue, user, pass, nodeEnv } });
}

describe("Bull Board at /admin/queues", () => {
  it("401 without credentials, 401 with a wrong password, 200 with the right ones", async () => {
    const app = appWith("ops", "s3cret-pass");
    const none = await request(app).get("/admin/queues");
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toMatch(/Basic/);
    expect(
      (await request(app).get("/admin/queues").set("Authorization", basic("ops", "nope"))).status,
    ).toBe(401);
    expect(
      (await request(app).get("/admin/queues").set("Authorization", basic("nope", "s3cret-pass")))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get("/admin/queues").set("Authorization", basic("ops", "s3cret-pass")))
        .status,
    ).toBe(200);
  });

  it("shows the real email queue", async () => {
    const res = await request(appWith("ops", "s3cret-pass"))
      .get("/admin/queues/api/queues")
      .set("Authorization", basic("ops", "s3cret-pass"));
    expect(res.status).toBe(200);
    expect(res.body.queues.map((q: { name: string }) => q.name)).toEqual(["email-send"]);
  });

  it("refuses to mount in production with placeholder or missing credentials", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [u, p] of [
      ["admin", "change-me"],
      [undefined, undefined],
      ["ops", ""],
    ] as const) {
      const res = await request(appWith(u, p, "production"))
        .get("/admin/queues")
        .set("Authorization", basic(u ?? "", p ?? ""));
      expect(res.status).toBe(404);
    }
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("mounts with placeholder credentials in dev, but warns loudly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(appWith("admin", "change-me"))
      .get("/admin/queues")
      .set("Authorization", basic("admin", "change-me"));
    expect(res.status).toBe(200);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/placeholder/i);
    warn.mockRestore();
  });
});
