import { DelayedError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { prisma } from "../db/prisma.js";
import type { HourlyLimiter } from "../rateLimit/hourlyLimiter.js";
import { sendMail, type OutgoingMail, type SentMail } from "../services/mailer.js";
import { notifyRateLimit, type RateLimitHook } from "../services/rateLimitNotifier.js";
import type { Sender } from "../generated/prisma/client.js";
import { EMAIL_QUEUE, type EmailJobData } from "./emailQueue.js";

export type SendFn = (sender: Sender, mail: OutgoingMail) => Promise<SentMail>;
export type ProcessResult = "sent" | "skipped" | { rescheduledTo: Date };

/**
 * Same email row always gets the same Message-ID, so if a send is ever
 * repeated (crash between SMTP and the DB update), the duplicate is
 * detectable on the receiving side.
 */
export function messageIdFor(emailId: string, senderEmail: string): string {
  const domain = senderEmail.split("@")[1] ?? "localhost";
  return `<${emailId}@${domain}>`;
}

export interface ProcessDeps {
  send: SendFn;
  isFinalAttempt: boolean;
  /** Omit to disable hourly limits (e.g. M3 tests). */
  limiter?: HourlyLimiter;
  onRateLimited?: RateLimitHook;
}

export async function processEmail(emailId: string, deps: ProcessDeps): Promise<ProcessResult> {
  // Atomic claim: only one caller can move the row out of SCHEDULED.
  // Anyone else (duplicate job, second worker, stalled re-run) gets 0 rows and stops here.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Email"
    SET status = 'PROCESSING'::"EmailStatus"
    WHERE id = ${emailId} AND status = 'SCHEDULED'::"EmailStatus" AND "sentAt" IS NULL
    RETURNING id`;
  if (claimed.length === 0) return "skipped";

  const email = await prisma.email.findUniqueOrThrow({
    where: { id: emailId },
    include: { sender: true, campaign: { select: { hourlyLimit: true } } },
  });

  // Counter keys taken for THIS attempt; a failure refunds exactly these.
  let heldKeys: string[] = [];
  let result: SentMail;
  try {
    if (deps.limiter) {
      const slot = await deps.limiter.acquire({
        campaignId: email.campaignId,
        senderId: email.senderId,
        campaignLimit: email.campaign.hourlyLimit,
      });
      if (!slot.allowed) {
        // Over the limit: not a failure and not an attempt. Hand the row back
        // with its new time; the caller moves the BullMQ job to match.
        const resumeAt = await deps.limiter.nextSlot(email.senderId, slot.window);
        await prisma.email.updateMany({
          where: { id: emailId, status: "PROCESSING" },
          data: { status: "SCHEDULED", scheduledAt: resumeAt },
        });
        fireAndForget(deps.onRateLimited, {
          userId: email.userId,
          campaignId: email.campaignId,
          emailId,
          senderId: email.senderId,
          senderEmail: email.sender.email,
          blockedBy: slot.blockedBy,
          limit: slot.limit,
          window: slot.window,
          resumeAt,
        });
        return { rescheduledTo: resumeAt };
      }
      heldKeys = slot.keys;
    }

    await prisma.email.update({ where: { id: emailId }, data: { attempts: { increment: 1 } } });
    result = await deps.send(email.sender, {
      to: email.toEmail,
      subject: email.subject,
      text: email.body,
      messageId: messageIdFor(email.id, email.sender.email),
    });
  } catch (err) {
    if (heldKeys.length) {
      await deps
        .limiter!.refund(heldKeys)
        .catch((e) => console.error("[worker] refund failed:", e));
    }
    // Hand the row back to SCHEDULED so the BullMQ retry can claim it again,
    // or park it as FAILED when this was the last attempt.
    await prisma.email.updateMany({
      where: { id: emailId, status: "PROCESSING" },
      data: {
        status: deps.isFinalAttempt ? "FAILED" : "SCHEDULED",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  await prisma.email.updateMany({
    where: { id: emailId, status: "PROCESSING" },
    data: {
      status: "SENT",
      sentAt: new Date(),
      messageId: result.messageId,
      previewUrl: result.previewUrl,
      errorMessage: null,
    },
  });
  return "sent";
}

// The notifier must never slow down or break a send.
function fireAndForget(hook: RateLimitHook | undefined, event: Parameters<RateLimitHook>[0]) {
  if (!hook) return;
  void Promise.resolve()
    .then(() => hook(event))
    .catch((e) => console.error("[worker] rate-limit hook failed:", e));
}

export interface EmailWorkerSettings {
  connection: Redis;
  prefix: string;
  concurrency: number;
  send?: SendFn;
  limiter?: HourlyLimiter;
  /** Global floor between any two job starts across all workers; 0 = off. */
  minDelayMs?: number;
  onRateLimited?: RateLimitHook;
}

export function createEmailWorker(
  settings: EmailWorkerSettings,
): Worker<EmailJobData, "sent" | "skipped"> {
  const deps = {
    send: settings.send ?? sendMail,
    limiter: settings.limiter,
    onRateLimited: settings.onRateLimited ?? notifyRateLimit,
  };

  const processor = async (job: Job<EmailJobData>, token?: string) => {
    const result = await processEmail(job.data.emailId, {
      ...deps,
      // attemptsMade counts previous failures, so this run is attempt attemptsMade + 1.
      isFinalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    });
    if (typeof result === "object") {
      // Back to delayed at the new slot. DelayedError tells BullMQ this is
      // neither a completion nor a failure, so attemptsMade is untouched.
      await job.moveToDelayed(result.rescheduledTo.getTime(), token);
      throw new DelayedError();
    }
    return result;
  };

  const minDelay = settings.minDelayMs ?? 0;
  return new Worker<EmailJobData, "sent" | "skipped">(EMAIL_QUEUE, processor, {
    connection: settings.connection,
    prefix: settings.prefix,
    concurrency: settings.concurrency,
    // BullMQ keeps limiter state in Redis, so this floor holds across all workers.
    ...(minDelay > 0 ? { limiter: { max: 1, duration: minDelay } } : {}),
  });
}
