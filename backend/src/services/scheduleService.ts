import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { Sender } from "../generated/prisma/client.js";

const emailSchema = z.email();

export interface LeadReport {
  received: number;
  accepted: string[];
  duplicate: number;
  invalid: string[];
}

/** Trim + lowercase, drop invalid addresses, keep the first of any duplicates (in input order). */
export function normalizeLeads(raw: string[]): LeadReport {
  const seen = new Set<string>();
  const accepted: string[] = [];
  const invalid: string[] = [];
  let duplicate = 0;

  for (const lead of raw) {
    const email = lead.trim().toLowerCase();
    if (!emailSchema.safeParse(email).success) {
      invalid.push(lead);
    } else if (seen.has(email)) {
      duplicate += 1;
    } else {
      seen.add(email);
      accepted.push(email);
    }
  }
  return { received: raw.length, accepted, duplicate, invalid };
}

export interface CampaignInput {
  subject: string;
  body: string;
  startTime: Date;
  delayBetweenMs: number;
  hourlyLimit: number;
}

export interface PlannedEmail {
  id: string;
  toEmail: string;
  senderId: string;
  scheduledAt: Date;
}

/**
 * Lead i goes out at startTime + i * delayBetweenMs via sender i mod N.
 * (Hourly-window packing is added in M5.)
 */
export function planEmails(
  leads: string[],
  input: CampaignInput,
  senders: Sender[],
): PlannedEmail[] {
  return leads.map((toEmail, i) => ({
    id: randomUUID(),
    toEmail,
    senderId: senders[i % senders.length]!.id,
    scheduledAt: new Date(input.startTime.getTime() + i * input.delayBetweenMs),
  }));
}

// Keeps each INSERT well under Postgres' 65k bind-parameter limit.
const INSERT_CHUNK = 1000;

/** Campaign + every Email row in one transaction: all or nothing. */
export async function saveCampaign(userId: string, input: CampaignInput, planned: PlannedEmail[]) {
  const campaignId = randomUUID();
  const rows = planned.map((p) => ({
    ...p,
    campaignId,
    userId,
    subject: input.subject,
    body: input.body,
  }));

  const inserts = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    inserts.push(prisma.email.createMany({ data: rows.slice(i, i + INSERT_CHUNK) }));
  }
  await prisma.$transaction([
    prisma.campaign.create({
      data: { id: campaignId, userId, ...input, totalCount: planned.length },
    }),
    ...inserts,
  ]);
  return campaignId;
}
