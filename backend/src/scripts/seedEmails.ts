// Dev-only: inserts email rows directly (bypassing the API's pre-packing) and
// enqueues them on the dev queue, all due at the same moment. Handy for
// exercising the runtime rate limiter and its Slack alert.
//
//   npm run seed:emails -- [--count 3] [--delay 5000] [--user you@gmail.com]
//                          [--hourly-limit 100] [--senders 3]
//
// --user     an existing user's email (e.g. the Google account you logged in
//            with); defaults to a "Seed Demo" user.
// --senders  how many senders of the pool to spread the emails over.
import { parseArgs } from "node:util";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { createEmailQueue, enqueueEmail } from "../queue/emailQueue.js";
import { redis } from "../redis/connection.js";
import { ensureSenderPool } from "../services/senderService.js";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "3" },
    delay: { type: "string", default: "5000" },
    user: { type: "string" },
    "hourly-limit": { type: "string", default: "100" },
    senders: { type: "string" },
  },
});
const count = Number(values.count);
const delayMs = Number(values.delay);
const hourlyLimit = Number(values["hourly-limit"]);

const pool = await ensureSenderPool(env.SENDER_POOL_SIZE);
const senders = pool.slice(0, Number(values.senders ?? pool.length));
const user = values.user
  ? await prisma.user.findFirst({ where: { email: values.user.toLowerCase() } })
  : await prisma.user.upsert({
      where: { googleId: "seed-demo-user" },
      update: {},
      create: { googleId: "seed-demo-user", email: "demo@example.com", name: "Seed Demo" },
    });
if (!user) throw new Error(`No user with email ${values.user}; log in with Google first`);

const startTime = new Date(Date.now() + delayMs);
const subject = `Seed ${startTime.toISOString()}`;
const campaign = await prisma.campaign.create({
  data: {
    userId: user.id,
    subject,
    body: "Seeded by scripts/seedEmails.ts",
    startTime,
    delayBetweenMs: 0,
    hourlyLimit,
    totalCount: count,
  },
});

const queue = createEmailQueue({
  connection: redis,
  prefix: env.BULLMQ_PREFIX,
  attempts: env.EMAIL_JOB_ATTEMPTS,
  backoffMs: env.EMAIL_JOB_BACKOFF_MS,
});

console.log(
  `user ${user.email} · campaign ${campaign.id} · ${count} emails · hourlyLimit ${hourlyLimit}/sender · ${senders.length} sender(s)`,
);
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
