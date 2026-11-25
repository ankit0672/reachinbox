import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type CookieOptions, type Response } from "express";
import { Passport } from "passport";
import { createGoogleStrategy } from "../auth/google.js";
import type { AuthConfig } from "../auth/config.js";
import { requireAuth } from "../auth/requireAuth.js";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "../auth/session.js";
import { prisma } from "../db/prisma.js";
import { describeError } from "../lib/describeError.js";

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameValue = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Google login (GET /google, /google/callback), GET /me, POST /logout. */
export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();
  // Own Passport instance: no global state, no server-side sessions.
  const passport = new Passport();
  if (config.google) passport.use("google", createGoogleStrategy(config.google));

  const stateCookie: CookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/api/auth",
  };
  // Redirect targets are fixed config; only a known error code is appended.
  const loginFailed = (res: Response, code: string) =>
    res.redirect(`${config.frontendUrl}/login?error=${code}`);

  router.get("/google", (req, res, next) => {
    if (!config.google) return loginFailed(res, "google_not_configured");
    // CSRF protection for the OAuth round trip: a random state that must come
    // back unchanged and match this browser's short-lived httpOnly cookie.
    const state = randomBytes(32).toString("base64url");
    res.cookie(OAUTH_STATE_COOKIE, state, { ...stateCookie, maxAge: 10 * 60_000 });
    passport.authenticate("google", {
      session: false,
      scope: ["openid", "email", "profile"],
      state,
      prompt: "select_account",
    })(req, res, next);
  });

  router.get("/google/callback", (req, res, next) => {
    const expected: unknown = req.cookies?.[OAUTH_STATE_COOKIE];
    const returned = req.query.state;
    res.clearCookie(OAUTH_STATE_COOKIE, stateCookie); // one use only
    if (!config.google) return loginFailed(res, "google_not_configured");
    if (
      typeof expected !== "string" ||
      typeof returned !== "string" ||
      !sameValue(expected, returned)
    ) {
      return loginFailed(res, "invalid_state");
    }
    if (req.query.error) {
      return loginFailed(
        res,
        req.query.error === "access_denied" ? "access_denied" : "oauth_failed",
      );
    }

    passport.authenticate(
      "google",
      { session: false },
      (err: unknown, user: Express.User | false) => {
        if (err || !user) {
          if (err) console.error(`[auth] Google login failed: ${describeError(err)}`);
          return loginFailed(res, "oauth_failed");
        }
        res.cookie(SESSION_COOKIE, signSession(user.id, config), sessionCookieOptions(config));
        res.redirect(`${config.frontendUrl}/dashboard`);
      },
    )(req, res, next);
  });

  router.get("/me", requireAuth(config), async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl });
  });

  router.post("/logout", (_req, res) => {
    // Same attributes as when set; Express 5's clearCookie ignores maxAge itself.
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
    res.status(204).end();
  });

  return router;
}
