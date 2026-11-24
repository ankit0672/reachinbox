import type { CapName } from "../rateLimit/hourlyLimiter.js";

export interface RateLimitEvent {
  userId: string;
  campaignId: string;
  emailId: string;
  senderId: string;
  senderEmail: string;
  blockedBy: CapName;
  limit: number;
  window: number;
  resumeAt: Date;
}

export type RateLimitHook = (event: RateLimitEvent) => void | Promise<void>;

// TODO(M9): post a Slack message to the user's connected workspace. Look the
// connection up at call time (none -> return silently) and dedupe with
// SET {prefix}:slack:{userId}:{senderId}:{window} NX EX <2 windows>, so each
// user hears once per sender per window, not once per rescheduled email.
export const notifyRateLimit: RateLimitHook = () => {};
