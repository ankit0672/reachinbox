import { createHash, timingSafeEqual } from "node:crypto";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Router, type RequestHandler } from "express";
import type { EmailQueue } from "../queue/emailQueue.js";

export const BULL_BOARD_PATH = "/admin/queues";
// The values shipped in .env.example; never acceptable in production.
const PLACEHOLDER_PASSWORDS = new Set(["change-me"]);

export interface BullBoardOptions {
  queue: EmailQueue;
  user?: string;
  pass?: string;
  nodeEnv?: string;
}

// Hash first so the comparison is constant-time regardless of input length.
const digest = (s: string) => createHash("sha256").update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function basicAuth(user: string, pass: string): RequestHandler {
  return (req, res, next) => {
    const [scheme, encoded] = (req.header("authorization") ?? "").split(" ");
    const decoded = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString() : "";
    const sep = decoded.indexOf(":");
    // Evaluate both comparisons every time; no early exit on the user name.
    const userOk = safeEqual(sep >= 0 ? decoded.slice(0, sep) : "", user);
    const passOk = safeEqual(sep >= 0 ? decoded.slice(sep + 1) : "", pass);
    if (sep >= 0 && userOk && passOk) return next();
    res
      .set("WWW-Authenticate", 'Basic realm="Bull Board"')
      .status(401)
      .send("Authentication required");
  };
}

/**
 * Live BullMQ dashboard for the real email queue, behind basic auth.
 * Returns null (not mounted) when credentials are missing, or are the
 * .env.example placeholders in production.
 */
export function createBullBoardRouter(opts: BullBoardOptions): Router | null {
  const { user, pass } = opts;
  const production = opts.nodeEnv === "production";
  if (!user || !pass) {
    const log = production ? console.error : console.warn;
    log("[bull-board] BULL_BOARD_USER / BULL_BOARD_PASS not set: dashboard NOT mounted");
    return null;
  }
  if (PLACEHOLDER_PASSWORDS.has(pass)) {
    if (production) {
      console.error(
        "[bull-board] placeholder BULL_BOARD_PASS in production: dashboard NOT mounted",
      );
      return null;
    }
    console.warn(
      "[bull-board] WARNING: using the placeholder BULL_BOARD_PASS from .env.example; set a real one",
    );
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({ queues: [new BullMQAdapter(opts.queue)], serverAdapter });

  const router = Router();
  router.use(basicAuth(user, pass), serverAdapter.getRouter());
  return router;
}
