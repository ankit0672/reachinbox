import { Router } from "express";
import { prisma } from "../db/prisma.js";

/**
 * The compose page shows "Sender pool · N accounts". Senders are assigned by
 * the scheduler, so the UI only needs the pool size: never addresses or
 * SMTP credentials.
 */
export function createSendersRouter(): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.json({ count: await prisma.sender.count() });
  });
  return router;
}
