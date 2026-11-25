import type { ScheduleRequest, ValidationErrorBody } from "../api/schedule";
import { summarizeLeads } from "../lib/leads";
import { toIsoWithOffset } from "../lib/time";

export interface ComposeValues {
  /** Every address-like entry the user added (typed or uploaded), duplicates and invalid included. */
  entries: string[];
  subject: string;
  body: string;
  /** As typed: seconds between two emails. */
  delaySeconds: string;
  /** As typed: max emails per sender per hour. */
  hourlyLimit: string;
  /** null = start now. */
  startAt: Date | null;
}

export type ComposeField =
  "recipients" | "subject" | "body" | "delay" | "hourlyLimit" | "startTime";
export type FieldErrors = Partial<Record<ComposeField, string>>;

export const MAX_DELAY_SECONDS = 24 * 3600; // API: delayBetweenMs <= 24h
export const MAX_HOURLY_LIMIT = 100_000; // API: hourlyLimit <= 100000

export const emptyCompose = (): ComposeValues => ({
  entries: [],
  subject: "",
  body: "",
  delaySeconds: "",
  hourlyLimit: "",
  startAt: null,
});

export function validateCompose(v: ComposeValues, maxLeads: number): FieldErrors {
  const errors: FieldErrors = {};
  const leads = summarizeLeads(v.entries);
  if (leads.valid.length === 0) errors.recipients = "Add at least one valid recipient.";
  else if (leads.total > maxLeads) {
    errors.recipients = `Too many addresses: ${leads.total} (the limit is ${maxLeads} per campaign, duplicates and invalid entries included).`;
  }

  if (!v.subject.trim()) errors.subject = "Subject is required.";
  if (!v.body.trim()) errors.body = "Write the email body.";

  const delay = Number(v.delaySeconds);
  if (v.delaySeconds.trim() === "" || !Number.isFinite(delay)) {
    errors.delay = "Enter the delay in seconds.";
  } else if (delay < 1) errors.delay = "At least 1 second.";
  else if (delay > MAX_DELAY_SECONDS) errors.delay = "At most 24 hours (86400 seconds).";

  const limit = Number(v.hourlyLimit);
  if (v.hourlyLimit.trim() === "" || !Number.isInteger(limit)) {
    errors.hourlyLimit = "Enter a whole number.";
  } else if (limit < 1) errors.hourlyLimit = "At least 1.";
  else if (limit > MAX_HOURLY_LIMIT) errors.hourlyLimit = `At most ${MAX_HOURLY_LIMIT}.`;

  return errors;
}

/** The API payload. Start "now" is sent as the current time, always with an offset. */
export function toScheduleRequest(v: ComposeValues, now: Date = new Date()): ScheduleRequest {
  return {
    subject: v.subject.trim(),
    body: v.body,
    startTime: toIsoWithOffset(v.startAt ?? now),
    delayBetweenMs: Math.round(Number(v.delaySeconds) * 1000),
    hourlyLimit: Number(v.hourlyLimit),
    // Sent as entered: the server dedupes and validates again, and its counts are shown.
    leads: v.entries,
  };
}

const SERVER_FIELDS: Record<string, ComposeField> = {
  subject: "subject",
  body: "body",
  startTime: "startTime",
  delayBetweenMs: "delay",
  hourlyLimit: "hourlyLimit",
  leads: "recipients",
};

/** Maps a 400's `details` ("leads.3", "delayBetweenMs", ...) back onto the form. */
export function mapServerErrors(body: ValidationErrorBody): { fields: FieldErrors; form?: string } {
  const fields: FieldErrors = {};
  const unmatched: string[] = [];
  for (const d of body.details ?? []) {
    const field = SERVER_FIELDS[d.field.split(".")[0] ?? ""];
    if (field && !fields[field]) fields[field] = serverMessage(field, d.message);
    else if (!field) unmatched.push(d.message);
  }
  if (!body.details?.length) return { fields, form: body.error };
  return { fields, form: unmatched.length ? unmatched.join(" ") : undefined };
}

function serverMessage(field: ComposeField, message: string): string {
  // Server messages are in API units (ms); keep the field's own units in the UI.
  if (field === "delay") return `The server rejected this delay: ${message}`;
  return message.charAt(0).toUpperCase() + message.slice(1);
}
