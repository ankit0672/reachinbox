import { apiFetch } from "./client";
import type { SendersResponse } from "./types";

/** POST /api/schedule body. */
export interface ScheduleRequest {
  subject: string;
  body: string;
  /** ISO 8601 with a timezone offset. */
  startTime: string;
  delayBetweenMs: number;
  /** Per sender, per hour. */
  hourlyLimit: number;
  leads: string[];
}

export interface LeadCounts {
  received: number;
  accepted: number;
  duplicate: number;
  invalid: number;
}

/** 201 from POST /api/schedule. */
export interface ScheduleResponse {
  campaignId: string;
  count: number;
  leads: LeadCounts;
  invalidLeads: string[];
  firstScheduledAt: string;
  lastScheduledAt: string;
}

/** 400 "Validation failed" body. */
export interface ValidationErrorBody {
  error: string;
  details?: { field: string; message: string }[];
  leads?: LeadCounts;
}

/** 503 after commit: rows are saved, some jobs not queued yet. */
export interface PartialEnqueueBody {
  error: string;
  campaignId: string;
  queued: number;
  total: number;
}

export const scheduleCampaign = (req: ScheduleRequest) =>
  apiFetch<ScheduleResponse>("/api/schedule", { method: "POST", body: JSON.stringify(req) });

export const getSenders = () => apiFetch<SendersResponse>("/api/senders");
