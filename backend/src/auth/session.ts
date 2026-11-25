import type { CookieOptions } from "express";
import jwt from "jsonwebtoken";
import type { AuthConfig } from "./config.js";

export const SESSION_COOKIE = "reachinbox_session";
export const OAUTH_STATE_COOKIE = "reachinbox_oauth_state";

export function signSession(userId: string, config: AuthConfig): string {
  return jwt.sign({}, config.jwtSecret, {
    subject: userId,
    expiresIn: config.jwtExpiresInSeconds,
    algorithm: "HS256",
  });
}

/** The user id from a valid session token, or null (bad signature, expired, wrong alg, junk). */
export function verifySession(token: string, secret: string): string | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// httpOnly: not readable by page JS. SameSite=Lax: not sent on cross-site
// POSTs (CSRF), but sent on the top-level redirect back from Google.
export function sessionCookieOptions(config: AuthConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    maxAge: config.jwtExpiresInSeconds * 1000,
  };
}
