// TODO(M8): DEV-ONLY stand-in for Google OAuth. M8 replaces this single
// middleware with requireAuth (cookie session); nothing else should depend on
// how the user was resolved, only on req.user.
import type { RequestHandler } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

const emailSchema = z.email();

export function createDevUserMiddleware(nodeEnv: string = env.NODE_ENV): RequestHandler {
  if (nodeEnv === "production") {
    throw new Error("Dev user middleware must never run in production (TODO(M8): use real auth)");
  }

  return async (req, res, next) => {
    const email = req.header("x-dev-user-email")?.trim().toLowerCase();
    if (!email || !emailSchema.safeParse(email).success) {
      res.status(401).json({ error: "Missing or invalid X-Dev-User-Email header (dev-only auth)" });
      return;
    }

    const googleId = `dev:${email}`;
    const user = await prisma.user.upsert({
      where: { googleId },
      update: {},
      create: { googleId, email, name: email.split("@")[0] ?? email },
    });
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  };
}
