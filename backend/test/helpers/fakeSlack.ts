import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeInstall {
  teamId: string;
  teamName: string;
  authedUserId: string;
  botToken: string;
}

export interface SlackCall {
  method: string;
  token: string | null;
  body: Record<string, string>;
}

/**
 * Local stand-in for slack.com/api (oauth.v2.access, conversations.open,
 * chat.postMessage, auth.revoke). Records every call. Register an OAuth
 * `code -> install` with `installs.set(...)`; set `postError` to make
 * chat.postMessage fail like Slack does ({ ok: false, error }).
 */
export async function startFakeSlack() {
  const installs = new Map<string, FakeInstall>();
  const calls: SlackCall[] = [];
  const state = { postError: undefined as string | undefined };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const method = new URL(req.url!, "http://x").pathname.replace(/^\/api\//, "");
      const isJson = (req.headers["content-type"] ?? "").includes("json");
      const body = (
        isJson ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw))
      ) as Record<string, string>;
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "") || null;
      calls.push({ method, token, body });
      const reply = (o: object) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };
      const knownToken = [...installs.values()].some((i) => i.botToken === token);

      switch (method) {
        case "oauth.v2.access": {
          const install = installs.get(body.code ?? "");
          if (!install || !body.client_id || !body.client_secret)
            return reply({ ok: false, error: "invalid_code" });
          return reply({
            ok: true,
            access_token: install.botToken,
            token_type: "bot",
            scope: "chat:write,im:write",
            bot_user_id: "B0BOT",
            team: { id: install.teamId, name: install.teamName },
            authed_user: { id: install.authedUserId },
          });
        }
        case "conversations.open":
          if (!knownToken) return reply({ ok: false, error: "invalid_auth" });
          return reply({ ok: true, channel: { id: `D-${body.users}` } });
        case "chat.postMessage":
          if (!knownToken) return reply({ ok: false, error: "invalid_auth" });
          if (state.postError) return reply({ ok: false, error: state.postError });
          return reply({ ok: true, channel: body.channel, ts: String(Date.now() / 1000) });
        case "auth.revoke":
          return reply({ ok: true, revoked: knownToken });
        default:
          return reply({ ok: false, error: "unknown_method" });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    installs,
    calls,
    state,
    apiBaseUrl: `${base}/api`,
    authorizeUrl: `${base}/oauth/v2/authorize`,
    callsTo: (method: string) => calls.filter((c) => c.method === method),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
