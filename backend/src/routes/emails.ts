import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { EmailStatus } from "../generated/prisma/client.js";

export interface EmailsDeps {
  maxPageSize: number;
}

interface EmailRow {
  id: string;
  toEmail: string;
  subject: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: EmailStatus;
  previewUrl: string | null;
}

const toResult = (r: EmailRow) => ({
  id: r.id,
  toEmail: r.toEmail,
  subject: r.subject,
  scheduledAt: r.scheduledAt,
  sentAt: r.sentAt,
  status: r.status.toLowerCase(),
  previewUrl: r.status === "SENT" ? r.previewUrl : null,
});

/** Table data for the dashboard tabs, always scoped to the signed-in user. */
export function createEmailsRouter(deps: EmailsDeps): Router {
  const router = Router();
  const schema = z.object({
    status: z.enum(["scheduled", "sent"]).default("scheduled"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(deps.maxPageSize).default(20),
  });

  router.get("/", async (req, res) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { status, page, pageSize } = parsed.data;
    const userId = req.user!.id;
    const skip = (page - 1) * pageSize;

    if (status === "scheduled") {
      // Pending work, in the order it will go out: (scheduledAt, seq, id).
      const where = { userId, status: { in: ["SCHEDULED", "PROCESSING"] as EmailStatus[] } };
      const [total, rows] = await Promise.all([
        prisma.email.count({ where }),
        prisma.email.findMany({
          where,
          orderBy: [{ scheduledAt: "asc" }, { seq: "asc" }, { id: "asc" }],
          skip,
          take: pageSize,
        }),
      ]);
      res.json({ total, page, pageSize, results: rows.map(toResult) });
      return;
    }

    // Finished work, newest first: when it was sent, or when it failed.
    const [total, rows] = await Promise.all([
      prisma.email.count({ where: { userId, status: { in: ["SENT", "FAILED"] } } }),
      prisma.$queryRaw<EmailRow[]>`
        SELECT id, "toEmail", subject, "scheduledAt", "sentAt", status::text AS status, "previewUrl"
        FROM "Email"
        WHERE "userId" = ${userId} AND status IN ('SENT', 'FAILED')
        ORDER BY COALESCE("sentAt", "failedAt") DESC NULLS LAST, id ASC
        LIMIT ${pageSize} OFFSET ${skip}`,
    ]);
    res.json({ total, page, pageSize, results: rows.map(toResult) });
  });

  return router;
}
