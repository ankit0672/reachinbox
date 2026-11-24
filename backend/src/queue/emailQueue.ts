import { Queue, type Job } from "bullmq";
import type { Redis } from "ioredis";

export const EMAIL_QUEUE = "email-send";

export interface EmailJobData {
  emailId: string;
}

export interface EmailQueueSettings {
  connection: Redis;
  prefix: string;
  attempts: number;
  backoffMs: number;
}

export type EmailQueue = Queue<EmailJobData>;

export function createEmailQueue(settings: EmailQueueSettings): EmailQueue {
  return new Queue<EmailJobData>(EMAIL_QUEUE, {
    connection: settings.connection,
    prefix: settings.prefix,
    defaultJobOptions: {
      attempts: settings.attempts,
      backoff: { type: "exponential", delay: settings.backoffMs },
      // Completed jobs are disposable (the DB row is the record); keep a day for Bull Board.
      removeOnComplete: { age: 24 * 3600 },
      // Failed jobs stay for inspection.
      removeOnFail: false,
    },
  });
}

/**
 * One email row = one job: jobId is the email id, so adding the same email
 * again (retry, reconcile, double submit) returns the existing job instead
 * of creating a second one.
 */
export function enqueueEmail(
  queue: EmailQueue,
  email: { id: string; scheduledAt: Date },
  now = Date.now(),
): Promise<Job<EmailJobData>> {
  const job = toJob(email, now);
  return queue.add(job.name, job.data, job.opts);
}

// A past scheduledAt gives delay 0: send as soon as possible.
function toJob(email: { id: string; scheduledAt: Date }, now: number) {
  return {
    name: "send",
    data: { emailId: email.id },
    opts: { jobId: email.id, delay: Math.max(0, email.scheduledAt.getTime() - now) },
  };
}

export class EnqueueError extends Error {
  constructor(
    readonly queued: number,
    readonly total: number,
    cause: unknown,
  ) {
    super(`Queued ${queued} of ${total} emails before failing`, { cause });
  }
}

/**
 * Adds jobs in chunks with addBulk so a 1000+ lead campaign is a few Redis
 * round trips, not one per email. On failure, reports how many made it.
 */
export async function enqueueEmails(
  queue: Pick<EmailQueue, "addBulk">,
  emails: { id: string; scheduledAt: Date }[],
  chunkSize: number,
): Promise<number> {
  let queued = 0;
  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    const now = Date.now();
    try {
      await queue.addBulk(chunk.map((email) => toJob(email, now)));
    } catch (err) {
      throw new EnqueueError(queued, emails.length, err);
    }
    queued += chunk.length;
  }
  return queued;
}
