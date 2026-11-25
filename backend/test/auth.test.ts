import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthConfig } from "../src/auth/config.js";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from "../src/auth/session.js";
import { prisma } from "../src/db/prisma.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { cookiePair, loginAs, setCookie, testAuthConfig, TEST_JWT_SECRET } from "./helpers/auth.js";
import { startFakeGoogle } from "./helpers/fakeGoogle.js";
import { resetDb, seedSenders } from "./helpers/seed.js";
import { createTestQueue } from "./helpers/testQueue.js";
import { createTestIndex } from "./helpers/testIndex.js";

const ok = async () => {};
const checks = { database: ok, redis: ok, elasticsearch: ok };
const FRONTEND = "http://localhost:5173";

let google: Awaited<ReturnType<typeof startFakeGoogle>>;
let env: ReturnType<typeof createTestQueue>;
let t: Awaited<ReturnType<typeof createTestIndex>>;

function appWith(auth: Partial<AuthConfig> = {}) {
  return createApp(checks, {
    auth: testAuthConfig({ google: google.google, ...auth }),
    schedule: { emailQueue: env.queue, enqueueChunkSize: 500 },
    search: { index: t.index, maxPageSize: 50 },
    emails: { maxPageSize: 50 },
  });
}

/** Step 1 of the browser flow: /api/auth/google -> redirect to Google with a state. */
async function startLogin(app = appWith()) {
  const res = await request(app).get("/api/auth/google");
  const location = new URL(res.headers.location!);
  return {
    res,
    location,
    state: location.searchParams.get("state")!,
    stateCookie: cookiePair(setCookie(res, OAUTH_STATE_COOKIE)),
  };
}

/** Step 2: Google redirects back to the callback with ?code&state. */
function callback(app: ReturnType<typeof appWith>, q: Record<string, string>, cookie = "") {
  return request(app).get("/api/auth/google/callback").query(q).set("Cookie", cookie);
}

async function fullLogin(code: string, app = appWith()) {
  const { state, stateCookie } = await startLogin(app);
  return callback(app, { code, state }, stateCookie);
}

beforeEach(async () => {
  await resetDb();
  await seedSenders(1);
  google = await startFakeGoogle();
  env = createTestQueue();
  t = await createTestIndex();
});
afterEach(async () => {
  await google.close();
  await env.cleanup();
  await t.cleanup();
});
afterAll(() => prisma.$disconnect());

describe("requireAuth", () => {
  const protectedRoutes: [string, string][] = [
    ["post", "/api/schedule"],
    ["get", "/api/search"],
    ["get", "/api/emails"],
    ["get", "/api/auth/me"],
  ];

  it.each(protectedRoutes)("%s %s without a cookie -> 401", async (method, path) => {
    const res = await (request(appWith()) as never as Record<string, (p: string) => request.Test>)[
      method
    ]!(path);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  it("the removed X-Dev-User-Email header is no bypass", async () => {
    const res = await request(appWith())
      .get("/api/emails")
      .set("X-Dev-User-Email", "owner@example.com");
    expect(res.status).toBe(401);
  });

  it("rejects a tampered, expired, foreign-signed or orphaned session", async () => {
    const { user, cookie } = await loginAs("owner@example.com");
    const token = cookie.split("=")[1]!;
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    const expired = jwt.sign({ sub: user.id }, TEST_JWT_SECRET, { expiresIn: -10 });
    const foreign = jwt.sign({ sub: user.id }, "some-other-secret-0123456789abcdef0123", {
      expiresIn: 60,
    });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user.id, exp: 9_999_999_999 })}.`;
    for (const bad of [tampered, expired, foreign, none, "garbage"]) {
      const res = await request(appWith())
        .get("/api/emails")
        .set("Cookie", `${SESSION_COOKIE}=${bad}`);
      expect(res.status).toBe(401);
    }
    // valid token, but the user was deleted
    await prisma.user.delete({ where: { id: user.id } });
    expect((await request(appWith()).get("/api/emails").set("Cookie", cookie)).status).toBe(401);
  });

  it("a valid session cookie gets through", async () => {
    const { cookie } = await loginAs("owner@example.com");
    expect((await request(appWith()).get("/api/emails").set("Cookie", cookie)).status).toBe(200);
  });

  it("/health and /api/auth/* stay public", async () => {
    const app = appWith();
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/api/auth/google")).status).toBe(302);
    expect((await request(app).post("/api/auth/logout")).status).toBe(204);
  });
});

describe("Google OAuth flow (fake Google, real passport)", () => {
  it("/api/auth/google redirects to Google with a random state and sets a state cookie", async () => {
    const a = await startLogin();
    const b = await startLogin();
    expect(a.res.status).toBe(302);
    expect(a.location.origin + a.location.pathname).toBe(google.google.authorizationURL);
    expect(a.location.searchParams.get("client_id")).toBe("fake-client-id");
    expect(a.location.searchParams.get("scope")).toMatch(/email/);
    expect(a.state).toMatch(/^[\w-]{32,}$/);
    expect(a.state).not.toBe(b.state);
    expect(setCookie(a.res, OAUTH_STATE_COOKIE)).toMatch(/HttpOnly/);
  });

  it("first login creates the user, sets the session cookie and redirects to the dashboard", async () => {
    google.profiles.set("code-1", {
      sub: "g-111",
      email: "Ana@Example.com",
      name: "Ana Lima",
      picture: "https://img/ana.png",
    });
    const res = await fullLogin("code-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard`);
    const session = setCookie(res, SESSION_COOKIE);
    expect(session).toBeDefined();
    const user = await prisma.user.findUniqueOrThrow({ where: { googleId: "g-111" } });
    expect(user).toMatchObject({
      email: "ana@example.com",
      name: "Ana Lima",
      avatarUrl: "https://img/ana.png",
    });

    const me = await request(appWith()).get("/api/auth/me").set("Cookie", cookiePair(session));
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id: user.id,
      name: "Ana Lima",
      email: "ana@example.com",
      avatarUrl: "https://img/ana.png",
    });
  });

  it("a second login refreshes name, email and avatar on the same user", async () => {
    google.profiles.set("c1", {
      sub: "g-222",
      email: "bo@example.com",
      name: "Bo",
      picture: "https://img/1.png",
    });
    await fullLogin("c1");
    google.profiles.set("c2", {
      sub: "g-222",
      email: "bo@new.example.com",
      name: "Bo Renamed",
      picture: "https://img/2.png",
    });
    await fullLogin("c2");

    const users = await prisma.user.findMany({ where: { googleId: "g-222" } });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: "bo@new.example.com",
      name: "Bo Renamed",
      avatarUrl: "https://img/2.png",
    });
  });

  it("two simultaneous first logins for the same Google account: both succeed, one user row", async () => {
    google.profiles.set("race-a", { sub: "g-race", email: "race@example.com", name: "Racer" });
    google.profiles.set("race-b", { sub: "g-race", email: "race@example.com", name: "Racer" });
    const app = appWith();
    const [a, b] = await Promise.all([fullLogin("race-a", app), fullLogin("race-b", app)]);
    expect([a.headers.location, b.headers.location]).toEqual([
      `${FRONTEND}/dashboard`,
      `${FRONTEND}/dashboard`,
    ]);
    expect(await prisma.user.count({ where: { googleId: "g-race" } })).toBe(1);
  });

  it("the race loser (P2002 on insert) re-reads the winner's row, deterministically", async () => {
    google.profiles.set("lose", { sub: "g-lose", email: "lose@example.com", name: "Loser" });
    let winnerId = "";
    const spy = vi.spyOn(prisma.user, "upsert").mockImplementationOnce((async () => {
      winnerId = (
        await prisma.user.create({
          data: { googleId: "g-lose", email: "lose@example.com", name: "Loser" },
        })
      ).id;
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    }) as never);

    const res = await fullLogin("lose");
    spy.mockRestore();
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard`);
    const me = await request(appWith())
      .get("/api/auth/me")
      .set("Cookie", cookiePair(setCookie(res, SESSION_COOKIE)));
    expect(me.body.id).toBe(winnerId);
  });

  it.each([
    [
      "a tampered state",
      (s: string, c: string) => ({ q: { code: "x", state: s + "x" }, cookie: c }),
      "invalid_state",
    ],
    [
      "a missing state cookie",
      (s: string) => ({ q: { code: "x", state: s }, cookie: "" }),
      "invalid_state",
    ],
    [
      "no state at all",
      (_s: string, c: string) => ({ q: { code: "x" }, cookie: c }),
      "invalid_state",
    ],
    [
      "Google denying consent",
      (s: string, c: string) => ({ q: { error: "access_denied", state: s }, cookie: c }),
      "access_denied",
    ],
    [
      "a code Google rejects",
      (s: string, c: string) => ({ q: { code: "unknown-code", state: s }, cookie: c }),
      "oauth_failed",
    ],
  ])("%s -> redirect to /login?error=..., no session", async (_name, build, error) => {
    google.profiles.set("x", { sub: "g-x", email: "x@example.com", name: "X" });
    const app = appWith();
    const { state, stateCookie } = await startLogin(app);
    const { q, cookie } = build(state, stateCookie);
    const res = await callback(app, q, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND}/login?error=${error}`);
    expect(setCookie(res, SESSION_COOKIE) ?? "").not.toMatch(
      new RegExp(`^${SESSION_COOKIE}=[^;]+;`),
    );
    expect(await prisma.user.count({ where: { googleId: "g-x" } })).toBe(0);
  });

  it("a state cannot be replayed (the state cookie is cleared after the callback)", async () => {
    google.profiles.set("once", { sub: "g-once", email: "once@example.com", name: "Once" });
    const app = appWith();
    const { state, stateCookie } = await startLogin(app);
    const first = await callback(app, { code: "once", state }, stateCookie);
    expect(setCookie(first, OAUTH_STATE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("without Google credentials the server still starts; login redirects with an error", async () => {
    const app = appWith({ google: undefined });
    expect((await request(app).get("/health")).status).toBe(200);
    const res = await request(app).get("/api/auth/google");
    expect(res.headers.location).toBe(`${FRONTEND}/login?error=google_not_configured`);
  });
});

describe("session cookie", () => {
  it("is httpOnly, SameSite=Lax, path /, with the configured max age, not Secure outside production", async () => {
    google.profiles.set("c", { sub: "g-c", email: "c@example.com", name: "C" });
    const line = setCookie(await fullLogin("c"), SESSION_COOKIE)!;
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=3600/);
    expect(line).not.toMatch(/Secure/);
  });

  it("is Secure in production", async () => {
    google.profiles.set("p", { sub: "g-p", email: "p@example.com", name: "P" });
    const line = setCookie(await fullLogin("p", appWith({ secureCookies: true })), SESSION_COOKIE)!;
    expect(line).toMatch(/Secure/);
  });

  it("logout clears it", async () => {
    const { cookie } = await loginAs("owner@example.com");
    const res = await request(appWith()).post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("CORS", () => {
  it("allows FRONTEND_URL with credentials", async () => {
    const res = await request(appWith()).get("/health").set("Origin", FRONTEND);
    expect(res.headers["access-control-allow-origin"]).toBe(FRONTEND);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("gives other origins no CORS headers (simple request and preflight)", async () => {
    const simple = await request(appWith()).get("/health").set("Origin", "https://evil.example");
    expect(simple.headers["access-control-allow-origin"]).toBeUndefined();
    const preflight = await request(appWith())
      .options("/api/schedule")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
