import type { Redis } from "ioredis";
import { windowOf, windowStart } from "./window.js";

// Checks every cap first and increments only if all pass, in one atomic
// script, so concurrent workers can never push a counter past its limit.
// KEYS = counters; ARGV[1] = TTL seconds; ARGV[i+1] = limit for KEYS[i] (0 = no cap).
// Returns 0 when allowed, otherwise the 1-based index of the cap that blocked.
const ACQUIRE_LUA = `
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i + 1])
  if limit > 0 and tonumber(redis.call('GET', key) or '0') >= limit then
    return i
  end
end
for _, key in ipairs(KEYS) do
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ARGV[1])
end
return 0`;

// Gives back slots from a failed send. Never goes below 0 and never
// recreates a key that already expired.
const REFUND_LUA = `
for _, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') > 0 then
    redis.call('DECR', key)
  end
end
return 0`;

const CAPS = ["campaign", "sender", "global"] as const;
export type CapName = (typeof CAPS)[number];

export interface LimiterConfig {
  prefix: string;
  windowMs: number;
  /** MAX_EMAILS_PER_HOUR_PER_SENDER, shared by every campaign using the sender. 0 = off. */
  perSenderCap: number;
  /** MAX_EMAILS_PER_HOUR across all senders. 0 = off. */
  globalCap: number;
  rescheduleSpacingMs: number;
  now?: () => number;
}

export type AcquireResult =
  | { allowed: true; window: number; keys: string[] }
  | { allowed: false; window: number; blockedBy: CapName; limit: number };

export class HourlyLimiter {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: Redis,
    private readonly config: LimiterConfig,
  ) {
    this.ttlSeconds = Math.max(1, Math.ceil((2 * config.windowMs) / 1000));
  }

  private now(): number {
    return this.config.now?.() ?? Date.now();
  }

  /**
   * Takes one slot from every counter for this send, or none if any cap is
   * full. campaignLimit is campaign.hourlyLimit, which is PER SENDER.
   */
  async acquire(job: {
    campaignId: string;
    senderId: string;
    campaignLimit: number;
  }): Promise<AcquireResult> {
    const window = windowOf(this.now(), this.config.windowMs);
    const p = this.config.prefix;
    const keys = [
      `${p}:rl:cs:${job.campaignId}:${job.senderId}:${window}`,
      `${p}:rl:s:${job.senderId}:${window}`,
      `${p}:rl:g:${window}`,
    ];
    const limits = [job.campaignLimit, this.config.perSenderCap, this.config.globalCap];

    const blocked = Number(
      await this.redis.eval(ACQUIRE_LUA, keys.length, ...keys, this.ttlSeconds, ...limits),
    );
    if (blocked === 0) return { allowed: true, window, keys };
    return {
      allowed: false,
      window,
      blockedBy: CAPS[blocked - 1]!,
      limit: limits[blocked - 1]!,
    };
  }

  /** Refunds exactly the keys a previous acquire() incremented. */
  async refund(keys: string[]): Promise<void> {
    if (keys.length) await this.redis.eval(REFUND_LUA, keys.length, ...keys);
  }

  /**
   * Next free slot for an over-limit email: the start of the following
   * window plus rank * spacing. Rank is handed out in the order jobs hit the
   * limit, so emails that were due earlier keep earlier slots.
   */
  async nextSlot(senderId: string, window: number): Promise<Date> {
    const key = `${this.config.prefix}:rs:${senderId}:${window + 1}`;
    const [[, rank]] = (await this.redis.multi().incr(key).expire(key, this.ttlSeconds).exec()) as [
      [null, number],
      [null, number],
    ];
    const start = windowStart(window + 1, this.config.windowMs);
    return new Date(start + (rank - 1) * this.config.rescheduleSpacingMs);
  }
}
