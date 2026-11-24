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
  return queue.add(
    "send",
    { emailId: email.id },
    { jobId: email.id, delay: Math.max(0, email.scheduledAt.getTime() - now) },
  );
}
