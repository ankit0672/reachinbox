import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { decryptSecret } from "../src/lib/encryption.js";
import { SlackApi, type SlackConfig } from "../src/slack/slackApi.js";
import { loginAs, testAuthConfig, TEST_JWT_SECRET } from "./helpers/auth.js";
import { startFakeSlack } from "./helpers/fakeSlack.js";
import { resetDb } from "./helpers/seed.js";
import { createTestQueue } from "./helpers/testQueue.js";

const ok = async () => {};
const checks = { database: ok, redis: ok, elasticsearch: ok };
const FRONTEND = "http://localhost:5173";
const KEY = "0123456789abcdef".repeat(4);
const REDIRECT = "https://unit-test.ngrok-free.dev/api/slack/callback";

let slack: Awaited<ReturnType<typeof startFakeSlack>>;
let env: ReturnType<typeof createTestQueue>;
let me: Awaited<ReturnType<typeof loginAs>>;

function slackConfig(): SlackConfig {
  return {
    clientId: "fake-slack-client",
    clientSecret: "fake-slack-secret",
    redirectUrl: REDIRECT,
    authorizeUrl: slack.authorizeUrl,
  };
}

// null = Slack not configured (undefined would trigger the default)
function appWith(config: SlackConfig | null = slackConfig()) {
  return createApp(checks, {
    auth: testAuthConfig(),
    slack: {
      config: config ?? undefined,
      api: new SlackApi(slack.apiBaseUrl),
      redis: env.connection,
      prefix: env.prefix,
      encryptionKey: KEY,
    },
  });
}

/** Browser flow step 1: Connect Slack (needs the login cookie). */
async function connect(app = appWith(), cookie = me.cookie) {
  const res = await request(app).get("/api/slack/connect").set("Cookie", cookie);
  const location = new URL(res.headers.location!);
  return { res, location, state: location.searchParams.get("state")! };
}

/** Step 2: Slack sends the browser to the callback on the tunnel host: NO login cookie. */
const callback = (app: ReturnType<typeof appWith>, q: Record<string, string>) =>
  request(app).get("/api/slack/callback").query(q);

beforeEach(async () => {
  await resetDb();
  await prisma.slackConnection.deleteMany();
  slack = await startFakeSlack();
  env = createTestQueue();
  me = await loginAs("owner@example.com");
  slack.installs.set("good-code", {
    teamId: "T1",
    teamName: "reachinbox-dev",
    authedUserId: "U-OWNER",
    botToken: "xoxb-first-token",
  });
});
afterEach(async () => {
  await slack.close();
  await env.cleanup();
});
afterAll(() => prisma.$disconnect());

describe("GET /api/slack/connect", () => {
  it("requires login", async () => {
    expect((await request(appWith()).get("/api/slack/connect")).status).toBe(401);
  });

  it("redirects to Slack's authorize page with our client, scopes, redirect URL and a signed state", async () => {
    const { res, location, state } = await connect();
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(slack.authorizeUrl);
    expect(location.searchParams.get("client_id")).toBe("fake-slack-client");
    expect(location.searchParams.get("scope")).toBe("chat:write,im:write");
    expect(location.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(state.split(".")).toHaveLength(3); // a JWT
  });

  it("without Slack credentials: redirects back with slack=not_configured", async () => {
    const res = await request(appWith(null)).get("/api/slack/connect").set("Cookie", me.cookie);
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard?slack=not_configured`);
  });
});

describe("GET /api/slack/callback", () => {
  it("is public, exchanges the code, opens a DM, stores the token ENCRYPTED, redirects to the dashboard", async () => {
    const app = appWith();
    const { state } = await connect(app);
    const res = await callback(app, { code: "good-code", state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard?slack=connected`);
    const [exchange] = slack.callsTo("oauth.v2.access");
    expect(exchange!.body).toMatchObject({
      client_id: "fake-slack-client",
      code: "good-code",
      redirect_uri: REDIRECT,
    });
    expect(slack.callsTo("conversations.open")[0]).toMatchObject({
      token: "xoxb-first-token",
      body: { users: "U-OWNER" },
    });

    const row = await prisma.slackConnection.findUniqueOrThrow({ where: { userId: me.user.id } });
    expect(row).toMatchObject({ teamId: "T1", teamName: "reachinbox-dev", channelId: "D-U-OWNER" });
    expect(row.botToken).not.toContain("xoxb");
    expect(decryptSecret(row.botToken, KEY)).toBe("xoxb-first-token");
  });

  it.each([
    ["a forged state", () => "not.a.jwt"],
    [
      "a state signed with another secret",
      () =>
        jwt.sign({ purpose: "slack-connect", jti: "j1" }, "x".repeat(40), { subject: me.user.id }),
    ],
    ["a login session token instead of a state", () => me.cookie.split("=")[1]!],
    [
      "an expired state",
      () =>
        jwt.sign({ purpose: "slack-connect", jti: "j2" }, TEST_JWT_SECRET, {
          subject: me.user.id,
          expiresIn: -5,
        }),
    ],
  ])("rejects %s (no token exchange, nothing stored)", async (_name, makeState) => {
    const res = await callback(appWith(), { code: "good-code", state: makeState() });
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard?slack=invalid_state`);
    expect(slack.callsTo("oauth.v2.access")).toHaveLength(0);
    expect(await prisma.slackConnection.count()).toBe(0);
  });

  it("a state works only once (replay is rejected)", async () => {
    const app = appWith();
    const { state } = await connect(app);
    await callback(app, { code: "good-code", state });
    const replay = await callback(app, { code: "good-code", state });
    expect(replay.headers.location).toBe(`${FRONTEND}/dashboard?slack=invalid_state`);
    expect(slack.callsTo("oauth.v2.access")).toHaveLength(1);
  });

  it("user cancels on Slack -> slack=denied", async () => {
    const app = appWith();
    const { state } = await connect(app);
    const res = await callback(app, { error: "access_denied", state });
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard?slack=denied`);
  });

  it("Slack rejects the code -> slack=error, logged, nothing stored", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWith();
    const { state } = await connect(app);
    const res = await callback(app, { code: "bad-code", state });
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard?slack=error`);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/invalid_code/);
    expect(await prisma.slackConnection.count()).toBe(0);
    errors.mockRestore();
  });

  it("reconnecting replaces the connection (one row, new token)", async () => {
    const app = appWith();
    await callback(app, { code: "good-code", state: (await connect(app)).state });
    slack.installs.set("code-2", {
      teamId: "T1",
      teamName: "reachinbox-dev",
      authedUserId: "U-OWNER",
      botToken: "xoxb-second-token",
    });
    await callback(app, { code: "code-2", state: (await connect(app)).state });

    const rows = await prisma.slackConnection.findMany();
    expect(rows).toHaveLength(1);
    expect(decryptSecret(rows[0]!.botToken, KEY)).toBe("xoxb-second-token");
  });
});

describe("status and disconnect", () => {
  it("status never exposes the token", async () => {
    const app = appWith();
    expect((await request(app).get("/api/slack/status").set("Cookie", me.cookie)).body).toEqual({
      available: true,
      connected: false,
    });
    await callback(app, { code: "good-code", state: (await connect(app)).state });

    const res = await request(app).get("/api/slack/status").set("Cookie", me.cookie);
    expect(res.body).toEqual({
      available: true,
      connected: true,
      teamName: "reachinbox-dev",
      connectedAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/xoxb|botToken|v1\./);
  });

  it("status and disconnect require login", async () => {
    expect((await request(appWith()).get("/api/slack/status")).status).toBe(401);
    expect((await request(appWith()).delete("/api/slack/disconnect")).status).toBe(401);
  });

  it("disconnect revokes the token at Slack and deletes the row; reconnect works afterwards", async () => {
    const app = appWith();
    await callback(app, { code: "good-code", state: (await connect(app)).state });

    const res = await request(app).delete("/api/slack/disconnect").set("Cookie", me.cookie);
    expect(res.status).toBe(204);
    expect(slack.callsTo("auth.revoke")[0]?.token).toBe("xoxb-first-token");
    expect(await prisma.slackConnection.count()).toBe(0);
    expect(
      (await request(app).get("/api/slack/status").set("Cookie", me.cookie)).body.connected,
    ).toBe(false);
    expect(
      (await request(app).delete("/api/slack/disconnect").set("Cookie", me.cookie)).status,
    ).toBe(204); // idempotent

    await callback(app, { code: "good-code", state: (await connect(app)).state });
    expect(await prisma.slackConnection.count()).toBe(1);
  });

  it("without Slack credentials: status says unavailable", async () => {
    const res = await request(appWith(null)).get("/api/slack/status").set("Cookie", me.cookie);
    expect(res.body).toEqual({ available: false, connected: false });
  });
});
