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

// Default hook: does nothing. The worker uses createSlackNotifier
// (services/slackNotifier.ts) when ENCRYPTION_KEY is configured.
export const notifyRateLimit: RateLimitHook = () => {};
