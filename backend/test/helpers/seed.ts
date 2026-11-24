import { prisma } from "../../src/db/prisma.js";
import type { EmailStatus } from "../../src/generated/prisma/client.js";

// Test-only DB fixtures. There is no schedule API yet (M4), so rows are seeded directly.

export async function resetDb(): Promise<void> {
  await prisma.email.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.user.deleteMany();
  await prisma.sender.deleteMany();
}

export async function seedEmail(
  overrides: { toEmail?: string; scheduledAt?: Date; status?: EmailStatus } = {},
) {
  const sender = await prisma.sender.upsert({
    where: { email: "sender1@ethereal.test" },
    update: {},
    create: {
      email: "sender1@ethereal.test",
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
      smtpUser: "sender1@ethereal.test",
      smtpPass: "secret",
      label: "Sender 1",
    },
  });
  const user = await prisma.user.upsert({
    where: { googleId: "test-google-id" },
    update: {},
    create: { googleId: "test-google-id", email: "owner@example.com", name: "Test Owner" },
  });
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      subject: "Hello",
      body: "Body",
      startTime: new Date(),
      delayBetweenMs: 0,
      hourlyLimit: 100,
      totalCount: 1,
    },
  });
  return prisma.email.create({
    data: {
      campaignId: campaign.id,
      userId: user.id,
      senderId: sender.id,
      toEmail: overrides.toEmail ?? "lead@example.com",
      subject: "Hello",
      body: "Body",
      scheduledAt: overrides.scheduledAt ?? new Date(),
      status: overrides.status ?? "SCHEDULED",
    },
  });
}

export function getEmail(id: string) {
  return prisma.email.findUniqueOrThrow({ where: { id } });
}

/** Inserts `n` fake senders (labels "Sender 1".."Sender n") in a stable order. */
export async function seedSenders(n: number) {
  for (let i = 1; i <= n; i++) {
    await prisma.sender.create({
      data: {
        email: `sender${i}@ethereal.test`,
        smtpHost: "smtp.ethereal.email",
        smtpPort: 587,
        smtpUser: `sender${i}@ethereal.test`,
        smtpPass: "secret",
        label: `Sender ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      },
    });
  }
  return prisma.sender.findMany({ orderBy: { createdAt: "asc" } });
}
