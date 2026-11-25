import { Router, type Response } from "express";
import type { Redis } from "ioredis";
import type { AuthConfig } from "../auth/config.js";
import { prisma } from "../db/prisma.js";
import { describeError } from "../lib/describeError.js";
import { decryptSecret, encryptSecret } from "../lib/encryption.js";
import { signConnectState, verifyConnectState } from "../slack/connectState.js";
import {
  SLACK_AUTHORIZE_URL,
  SLACK_BOT_SCOPES,
  type SlackApi,
  type SlackConfig,
} from "../slack/slackApi.js";

export interface SlackDeps {
  /** Undefined when SLACK_* credentials aren't configured. */
  config?: SlackConfig;
  api: SlackApi;
  redis: Redis;
  prefix: string;
  encryptionKey?: string;
}

interface OAuthAccess {
  access_token: string;
  team: { id: string; name: string };
  authed_user: { id: string };
}

/**
 * Two routers: `callback` is public (Slack redirects the browser there,
 * possibly on another host without our login cookie; the signed state
 * identifies the user), the rest need a session.
 */
export function createSlackRouters(deps: SlackDeps, auth: AuthConfig) {
  const enabled = deps.config && deps.encryptionKey ? deps.config : undefined;
  // Fixed redirect target; only a known outcome code is appended.
  const back = (res: Response, outcome: string) =>
    res.redirect(`${auth.frontendUrl}/dashboard?slack=${outcome}`);

  const callback = Router();
  callback.get("/callback", async (req, res) => {
    if (!enabled) return back(res, "not_configured");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const verified = verifyConnectState(state, auth.jwtSecret);
    // Burn the state so it can't be replayed (SET NX: only the first use wins).
    const fresh =
      verified &&
      (await deps.redis.set(`${deps.prefix}:slack:state:${verified.jti}`, "used", "EX", 900, "NX"));
    if (!verified || fresh !== "OK") return back(res, "invalid_state");
    if (req.query.error) return back(res, req.query.error === "access_denied" ? "denied" : "error");
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return back(res, "error");

    try {
      const access = await deps.api.call<OAuthAccess>("oauth.v2.access", {
        form: {
          client_id: enabled.clientId,
          client_secret: enabled.clientSecret,
          code,
          redirect_uri: enabled.redirectUrl,
        },
      });
      // Alerts go to a DM between the bot and the person who connected Slack.
      const dm = await deps.api.call<{ channel: { id: string } }>("conversations.open", {
        token: access.access_token,
        json: { users: access.authed_user.id },
      });
      const data = {
        teamId: access.team.id,
        teamName: access.team.name,
        botToken: encryptSecret(access.access_token, deps.encryptionKey!),
        channelId: dm.channel.id,
      };
      await prisma.slackConnection.upsert({
        where: { userId: verified.userId },
        update: data,
        create: { userId: verified.userId, ...data },
      });
      console.log(`[slack] user ${verified.userId} connected workspace "${access.team.name}"`);
      return back(res, "connected");
    } catch (err) {
      console.error(`[slack] connect failed for user ${verified.userId}: ${describeError(err)}`);
      return back(res, "error");
    }
  });

  const authed = Router();
  authed.get("/connect", (req, res) => {
    if (!enabled) return back(res, "not_configured");
    const url = new URL(enabled.authorizeUrl ?? SLACK_AUTHORIZE_URL);
    url.searchParams.set("client_id", enabled.clientId);
    url.searchParams.set("scope", SLACK_BOT_SCOPES);
    url.searchParams.set("redirect_uri", enabled.redirectUrl);
    url.searchParams.set("state", signConnectState(req.user!.id, auth.jwtSecret));
    res.redirect(url.toString());
  });

  authed.get("/status", async (req, res) => {
    const conn = await prisma.slackConnection.findUnique({ where: { userId: req.user!.id } });
    if (!conn) {
      res.json({ available: Boolean(enabled), connected: false });
      return;
    }
    // Never the token, encrypted or not.
    res.json({
      available: Boolean(enabled),
      connected: true,
      teamName: conn.teamName,
      connectedAt: conn.createdAt,
    });
  });

  authed.delete("/disconnect", async (req, res) => {
    const conn = await prisma.slackConnection.findUnique({ where: { userId: req.user!.id } });
    if (conn) {
      // Best effort: revoke at Slack so the token is useless even if leaked.
      try {
        if (deps.encryptionKey) {
          await deps.api.call("auth.revoke", {
            token: decryptSecret(conn.botToken, deps.encryptionKey),
            form: {},
          });
        }
      } catch (err) {
        console.error(`[slack] token revoke failed (deleting anyway): ${describeError(err)}`);
      }
      await prisma.slackConnection.deleteMany({ where: { userId: req.user!.id } });
    }
    res.status(204).end();
  });

  return { callback, authed };
}
