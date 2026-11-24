import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { Sender } from "../generated/prisma/client.js";
import { windowOf, windowStart } from "../rateLimit/window.js";

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
  /** Max emails per sender per window for this campaign. */
  hourlyLimit: number;
}

export interface PlannedEmail {
  id: string;
  seq: number;
  toEmail: string;
  senderId: string;
  scheduledAt: Date;
}

/** Emails already booked for a sender in a window (from earlier campaigns). */
export interface ExistingLoad {
  senderId: string;
  window: number;
  count: number;
}

export interface PlanContext {
  now: number;
  windowMs: number;
  perSenderCap: number; // 0 = off
  globalCap: number; // 0 = off
  horizonMs: number;
  existing: ExistingLoad[];
}

export class PlanningHorizonError extends Error {}

const fits = (cap: number, used: number) => cap === 0 || used < cap;

/**
 * Pre-packs leads into rate-limit windows. Lead i (seq i) goes at the first
 * time >= previous + delayBetweenMs whose window still has room under every
 * cap, on the next sender in rotation that has room. So scheduledAt never
 * decreases with seq, and a full window pushes the rest of the campaign to
 * the next window start (spacing resumes from there). Best effort: the
 * runtime limiter is the authority.
 */
export function planEmails(
  leads: string[],
  input: CampaignInput,
  senders: Sender[],
  ctx: PlanContext,
): PlannedEmail[] {
  const W = ctx.windowMs;
  const perSender = new Map<string, number>(); // `${window}:${senderId}` -> booked (all campaigns)
  const perWindow = new Map<number, number>(); // window -> booked (all senders)
  const ours = new Map<string, number>(); // `${window}:${senderId}` -> booked by this campaign
  const bump = (m: Map<string | number, number>, k: string | number, n = 1) =>
    m.set(k, (m.get(k) ?? 0) + n);
  for (const e of ctx.existing) {
    bump(perSender, `${e.window}:${e.senderId}`, e.count);
    bump(perWindow, e.window, e.count);
  }

  const first = Math.max(input.startTime.getTime(), ctx.now);
  const horizonEnd = first + ctx.horizonMs;

  // Start the rotation at the least-loaded sender in the first window (ties: sender order).
  const w0 = windowOf(first, W);
  let next = 0;
  senders.forEach((s, i) => {
    const load = perSender.get(`${w0}:${s.id}`) ?? 0;
    if (load < (perSender.get(`${w0}:${senders[next]!.id}`) ?? 0)) next = i;
  });

  const planned: PlannedEmail[] = [];
  let t = first;
  for (let seq = 0; seq < leads.length; seq++) {
    if (seq > 0) t += input.delayBetweenMs;
    let picked = -1;
    for (;;) {
      if (t >= horizonEnd) {
        throw new PlanningHorizonError(
          `Scheduling ${leads.length} emails at ${input.hourlyLimit}/hour per sender would run past the ${Math.round(ctx.horizonMs / 86_400_000)}-day planning horizon`,
        );
      }
      const w = windowOf(t, W);
      if (fits(ctx.globalCap, perWindow.get(w) ?? 0)) {
        for (let k = 0; k < senders.length && picked < 0; k++) {
          const i = (next + k) % senders.length;
          const key = `${w}:${senders[i]!.id}`;
          if (
            fits(input.hourlyLimit, ours.get(key) ?? 0) &&
            fits(ctx.perSenderCap, perSender.get(key) ?? 0)
          ) {
            picked = i;
          }
        }
      }
      if (picked >= 0) break;
      t = windowStart(w + 1, W); // window full: try the next one from its start
    }

    const sender = senders[picked]!;
    const w = windowOf(t, W);
    bump(perSender, `${w}:${sender.id}`);
    bump(perWindow, w);
    bump(ours, `${w}:${sender.id}`);
    next = (picked + 1) % senders.length;
    planned.push({
      id: randomUUID(),
      seq,
      toEmail: leads[seq]!,
      senderId: sender.id,
      scheduledAt: new Date(t),
    });
  }
  return planned;
}

export interface PlanningSettings {
  windowMs: number;
  perSenderCap: number;
  globalCap: number;
  horizonMs: number;
  txTimeoutMs: number;
}

export class NoSendersError extends Error {}

// Serialises schedule requests: the load query, planning and inserts happen
// under one lock, so two concurrent requests can't book the same capacity.
const SCHEDULE_LOCK_ID = 7_301_002;
// Keeps each INSERT well under Postgres' 65k bind-parameter limit.
const INSERT_CHUNK = 1000;

/** Plans and saves the campaign + every Email row in one transaction: all or nothing. */
export async function scheduleCampaign(
  userId: string,
  input: CampaignInput,
  leads: string[],
  settings: PlanningSettings,
): Promise<{ campaignId: string; planned: PlannedEmail[] }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_ID})`;

      const senders = await tx.sender.findMany({
        orderBy: [{ createdAt: "asc" }, { email: "asc" }],
      });
      if (senders.length === 0) throw new NoSendersError("No senders configured yet");

      const now = Date.now();
      const W = settings.windowMs;
      const fromMs = windowStart(windowOf(Math.max(input.startTime.getTime(), now), W), W);
      const toMs = fromMs + settings.horizonMs + W;
      // Same epoch window math as the Redis keys. A SENT row counts in the window it was sent in.
      const rows = await tx.$queryRaw<{ senderId: string; window: bigint; count: number }[]>`
        SELECT "senderId",
               floor(extract(epoch from COALESCE("sentAt", "scheduledAt")) * 1000 / ${W})::bigint AS "window",
               count(*)::int AS "count"
        FROM "Email"
        WHERE status IN ('SCHEDULED', 'PROCESSING', 'SENT')
          AND extract(epoch from COALESCE("sentAt", "scheduledAt")) * 1000 >= ${fromMs}
          AND extract(epoch from COALESCE("sentAt", "scheduledAt")) * 1000 < ${toMs}
        GROUP BY 1, 2`;
      const existing = rows.map((r) => ({ ...r, window: Number(r.window) }));

      const planned = planEmails(leads, input, senders, {
        now,
        windowMs: W,
        perSenderCap: settings.perSenderCap,
        globalCap: settings.globalCap,
        horizonMs: settings.horizonMs,
        existing,
      });

      const campaignId = randomUUID();
      await tx.campaign.create({
        data: { id: campaignId, userId, ...input, totalCount: planned.length },
      });
      for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
        await tx.email.createMany({
          data: planned.slice(i, i + INSERT_CHUNK).map((p) => ({
            ...p,
            campaignId,
            userId,
            subject: input.subject,
            body: input.body,
          })),
        });
      }
      return { campaignId, planned };
    },
    { timeout: settings.txTimeoutMs, maxWait: settings.txTimeoutMs },
  );
}
