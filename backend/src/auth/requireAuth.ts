import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import type { AuthConfig } from "./config.js";
import { SESSION_COOKIE, verifySession } from "./session.js";

/** Resolves req.user from the signed session cookie, or answers 401. */
export function requireAuth(config: AuthConfig): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const userId = typeof token === "string" ? verifySession(token, config.jwtSecret) : null;
    // Re-read the user so a deleted account's still-valid token stops working.
    const user = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true },
        })
      : null;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    req.user = user;
    next();
  };
}
