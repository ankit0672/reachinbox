// Dev-only: inserts email rows directly (bypassing the API's pre-packing) and
// enqueues them on the dev queue. Handy for exercising the runtime limiter.
// Usage: npm run seed:emails -- [count=1] [delayMs=5000]
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { createEmailQueue, enqueueEmail } from "../queue/emailQueue.js";
import { redis } from "../redis/connection.js";
import { ensureSenderPool } from "../services/senderService.js";

const count = Number(process.argv[2] ?? 1);
const delayMs = Number(process.argv[3] ?? 5000);

const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);
const user = await prisma.user.upsert({
  where: { googleId: "seed-demo-user" },
  update: {},
  create: { googleId: "seed-demo-user", email: "demo@example.com", name: "Seed Demo" },
});

const startTime = new Date(Date.now() + delayMs);
const subject = `M3 seed ${startTime.toISOString()}`;
const campaign = await prisma.campaign.create({
  data: {
    userId: user.id,
    subject,
    body: "Seeded by scripts/seedEmails.ts",
    startTime,
    delayBetweenMs: 0,
    hourlyLimit: 100,
    totalCount: count,
  },
});

const queue = createEmailQueue({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  attempts: env.EMAIL_JOB_ATTEMPTS,
  backoffMs: env.EMAIL_JOB_BACKOFF_MS,
});

for (let i = 0; i < count; i++) {
  const email = await prisma.email.create({
    data: {
      campaignId: campaign.id,
      userId: user.id,
      senderId: senders[i % senders.length]!.id,
      seq: i,
      toEmail: `lead${i + 1}@example.com`,
      subject,
      body: campaign.body,
      scheduledAt: startTime,
    },
  });
  await enqueueEmail(queue, email);
  console.log(`queued ${email.id} -> ${email.toEmail} at ${startTime.toISOString()}`);
}

await queue.close();
await Promise.all([prisma.$disconnect(), redis.quit()]);
