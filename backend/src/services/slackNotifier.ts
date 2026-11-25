import type { Redis } from "ioredis";
import { prisma } from "../db/prisma.js";
import { describeError } from "../lib/describeError.js";
import { decryptSecret } from "../lib/encryption.js";
import type { SlackApi } from "../slack/slackApi.js";
import type { RateLimitEvent, RateLimitHook } from "./rateLimitNotifier.js";

export interface SlackNotifierDeps {
  redis: Redis;
  prefix: string;
  api: SlackApi;
  encryptionKey?: string;
  windowMs: number;
}

const LIMIT_TEXT: Record<RateLimitEvent["blockedBy"], (n: number) => string> = {
  campaign: (n) => `this campaign's limit of ${n} emails per sender per hour`,
  sender: (n) => `the sender limit of ${n} emails per hour`,
  global: (n) => `the global limit of ${n} emails per hour`,
};

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function rateLimitMessage(e: RateLimitEvent): string {
  return (
    `:warning: *Hourly limit reached* for sender ${e.senderEmail}: ${LIMIT_TEXT[e.blockedBy](e.limit)}.\n` +
    `The remaining emails were not dropped. They were rescheduled, and sending resumes at ${utc(e.resumeAt)}.`
  );
}

/**
 * Sends a Slack DM when a user's sender hits a rate limit. The connection is
 * looked up at call time, so connecting Slack later works without a restart.
 * At most one message per user, sender and window (Redis SET NX). Never throws:
 * a Slack problem must not affect sending.
 */
export function createSlackNotifier(deps: SlackNotifierDeps): RateLimitHook {
  const ttl = Math.max(1, Math.ceil((2 * deps.windowMs) / 1000));
  const once = (kind: string, e: RateLimitEvent) =>
    deps.redis.set(
      `${deps.prefix}:slack:${kind}:${e.userId}:${e.senderId}:${e.window}`,
      "1",
      "EX",
      ttl,
      "NX",
    );

  return async (e) => {
    let dedupeKey: string | undefined;
    try {
      const conn = await prisma.slackConnection.findUnique({ where: { userId: e.userId } });
      if (!conn?.channelId || !deps.encryptionKey) {
        if ((await once("skipped", e)) === "OK") {
          console.log(
            `[slack] user ${e.userId} has no Slack connection; rate-limit alert for ${e.senderEmail} not sent`,
          );
        }
        return;
      }
      if ((await once("sent", e)) !== "OK") return; // already alerted for this sender and window
      dedupeKey = `${deps.prefix}:slack:sent:${e.userId}:${e.senderId}:${e.window}`;

      await deps.api.call("chat.postMessage", {
        token: decryptSecret(conn.botToken, deps.encryptionKey),
        json: { channel: conn.channelId, text: rateLimitMessage(e), unfurl_links: false },
      });
      console.log(
        `[slack] rate-limit alert sent to user ${e.userId} (${conn.teamName}) for ${e.senderEmail}`,
      );
    } catch (err) {
      // Release the slot so the next limit hit in this window can retry.
      if (dedupeKey) await deps.redis.del(dedupeKey).catch(() => {});
      console.error(`[slack] rate-limit alert failed for user ${e.userId}: ${describeError(err)}`);
    }
  };
}
