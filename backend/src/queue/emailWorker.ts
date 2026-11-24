import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { prisma } from "../db/prisma.js";
import { sendMail, type OutgoingMail, type SentMail } from "../services/mailer.js";
import type { Sender } from "../generated/prisma/client.js";
import { EMAIL_QUEUE, type EmailJobData } from "./emailQueue.js";

export type SendFn = (sender: Sender, mail: OutgoingMail) => Promise<SentMail>;
export type ProcessResult = "sent" | "skipped";

/**
 * Same email row always gets the same Message-ID, so if a send is ever
 * repeated (crash between SMTP and the DB update), the duplicate is
 * detectable on the receiving side.
 */
export function messageIdFor(emailId: string, senderEmail: string): string {
  const domain = senderEmail.split("@")[1] ?? "localhost";
  return `<${emailId}@${domain}>`;
}

export async function processEmail(
  emailId: string,
  deps: { send: SendFn; isFinalAttempt: boolean },
): Promise<ProcessResult> {
  // Atomic claim: only one caller can move the row out of SCHEDULED.
  // Anyone else (duplicate job, second worker, stalled re-run) gets 0 rows and stops here.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Email"
    SET status = 'PROCESSING'::"EmailStatus", attempts = attempts + 1
    WHERE id = ${emailId} AND status = 'SCHEDULED'::"EmailStatus" AND "sentAt" IS NULL
    RETURNING id`;
  if (claimed.length === 0) return "skipped";

  const email = await prisma.email.findUniqueOrThrow({
    where: { id: emailId },
    include: { sender: true },
  });

  let result: SentMail;
  try {
    result = await deps.send(email.sender, {
      to: email.toEmail,
      subject: email.subject,
      text: email.body,
      messageId: messageIdFor(email.id, email.sender.email),
    });
  } catch (err) {
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

export interface EmailWorkerSettings {
  connection: Redis;
  prefix: string;
  concurrency: number;
  send?: SendFn;
}

export function createEmailWorker(
  settings: EmailWorkerSettings,
): Worker<EmailJobData, ProcessResult> {
  const send = settings.send ?? sendMail;
  return new Worker<EmailJobData, ProcessResult>(
    EMAIL_QUEUE,
    (job) =>
      processEmail(job.data.emailId, {
        send,
        // attemptsMade counts previous failures, so this run is attempt attemptsMade + 1.
        isFinalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      }),
    { connection: settings.connection, prefix: settings.prefix, concurrency: settings.concurrency },
  );
}
