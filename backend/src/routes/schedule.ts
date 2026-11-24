import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { EnqueueError, enqueueEmails, type EmailQueue } from "../queue/emailQueue.js";
import { normalizeLeads, planEmails, saveCampaign } from "../services/scheduleService.js";
import { listSenders } from "../services/senderService.js";

export interface ScheduleDeps {
  emailQueue: Pick<EmailQueue, "addBulk">;
  enqueueChunkSize: number;
}

const scheduleSchema = z.object({
  subject: z.string().trim().min(1, "subject is required").max(300),
  body: z.string().min(1, "body is required").max(env.MAX_EMAIL_BODY_CHARS),
  // Must carry a timezone (Z or ±hh:mm) so "10:00" is never ambiguous.
  startTime: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  delayBetweenMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600 * 1000),
  hourlyLimit: z.number().int().positive().max(100_000),
  leads: z
    .array(z.string().max(320))
    .min(1, "leads must contain at least one address")
    .max(env.MAX_LEADS_PER_CAMPAIGN),
});

// Only the first few invalid entries are echoed back, to keep responses small.
const MAX_INVALID_ECHO = 50;

export function createScheduleRouter(deps: ScheduleDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { leads, ...input } = parsed.data;

    // Counts come from the server's own pass over the list, never from the client.
    const report = normalizeLeads(leads);
    const leadSummary = {
      received: report.received,
      accepted: report.accepted.length,
      duplicate: report.duplicate,
      invalid: report.invalid.length,
    };
    const invalidLeads = report.invalid.slice(0, MAX_INVALID_ECHO);

    if (report.accepted.length === 0) {
      res
        .status(400)
        .json({ error: "No valid lead email addresses", leads: leadSummary, invalidLeads });
      return;
    }

    const senders = await listSenders();
    if (senders.length === 0) {
      res.status(503).json({ error: "No senders configured yet; try again shortly" });
      return;
    }

    const planned = planEmails(report.accepted, input, senders);
    const campaignId = await saveCampaign(req.user!.id, input, planned);

    // Enqueue only after the commit. If Redis fails part-way, the rows stay
    // SCHEDULED in Postgres (the source of truth) and are not rolled back.
    try {
      await enqueueEmails(deps.emailQueue, planned, deps.enqueueChunkSize);
    } catch (err) {
      if (!(err instanceof EnqueueError)) throw err;
      console.error(`[schedule] campaign ${campaignId}: ${err.message}:`, err.cause);
      res.status(503).json({
        error:
          "Campaign saved, but not every email could be queued. All emails remain SCHEDULED in the database and the missing jobs will be re-queued by reconciliation.",
        campaignId,
        queued: err.queued,
        total: err.total,
      });
      return;
    }

    res.status(201).json({
      campaignId,
      count: planned.length,
      leads: leadSummary,
      invalidLeads,
      firstScheduledAt: planned[0]!.scheduledAt,
      lastScheduledAt: planned[planned.length - 1]!.scheduledAt,
    });
  });

  return router;
}
