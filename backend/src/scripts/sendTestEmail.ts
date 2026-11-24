// Manual M2 check: ensures the sender pool, sends one mail through the first
// Ethereal sender, and prints its preview URL. Ethereal never delivers mail
// to real inboxes, so the recipient address is irrelevant.
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { closeTransports, sendMail } from "../services/mailer.js";
import { ensureSenderPool } from "../services/senderService.js";

const senders = await ensureSenderPool(env.SENDER_POOL_SIZE);
console.log(`Sender pool (${senders.length}):`);
for (const s of senders) console.log(`  - ${s.label}: ${s.email}`);

const sender = senders[0];
if (!sender) throw new Error("Sender pool is empty");

const result = await sendMail(sender, {
  to: "lead@example.com",
  subject: "ReachInbox M2 test email",
  text: `Sent at ${new Date().toISOString()} from ${sender.email}`,
});
console.log(`Message-ID: ${result.messageId}`);
console.log(`Preview URL: ${result.previewUrl}`);

closeTransports();
await prisma.$disconnect();
