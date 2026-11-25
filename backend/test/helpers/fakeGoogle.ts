import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * A local stand-in for Google's OAuth token and userinfo endpoints, so the
 * real passport flow runs in tests without network or real credentials.
 * Register `code -> profile` with `profiles.set(...)` before the callback.
 */
export async function startFakeGoogle() {
  const profiles = new Map<string, FakeProfile>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url.pathname === "/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const code = new URLSearchParams(body).get("code") ?? "";
        if (!profiles.has(code)) return json(400, { error: "invalid_grant" });
        json(200, { access_token: `tok-${code}`, token_type: "Bearer", expires_in: 3600 });
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/userinfo") {
      const bearer = (req.headers.authorization ?? "").replace("Bearer ", "");
      const token = bearer || url.searchParams.get("access_token") || "";
      const profile = profiles.get(token.replace(/^tok-/, ""));
      return profile
        ? json(200, { ...profile, email_verified: true })
        : json(401, { error: "invalid_token" });
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    profiles,
    google: {
      clientID: "fake-client-id",
      clientSecret: "fake-client-secret",
      callbackURL: "http://localhost:3001/api/auth/google/callback",
      authorizationURL: `${base}/authorize`,
      tokenURL: `${base}/token`,
      userProfileURL: `${base}/userinfo`,
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
