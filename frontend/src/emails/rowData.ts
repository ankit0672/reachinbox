import type { EmailListItem, EmailStatus, SearchHit } from "../api/types";
import { previewText } from "../lib/format";

/** What a row needs, whichever endpoint it came from (tab list or search). */
export interface EmailRowData {
  id: string;
  toEmail: string;
  subject: string;
  preview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
}

export const fromListItem = (e: EmailListItem): EmailRowData => ({
  id: e.id,
  toEmail: e.toEmail,
  subject: e.subject,
  preview: e.bodyPreview,
  status: e.status,
  scheduledAt: e.scheduledAt,
  sentAt: e.sentAt,
  errorMessage: e.errorMessage,
});

/** Search hits carry the full body; the preview is cut the same way as the server's. */
export const fromSearchHit = (h: SearchHit): EmailRowData => ({
  id: h.id,
  toEmail: h.toEmail,
  subject: h.subject,
  preview: previewText(h.body),
  status: h.status,
  scheduledAt: h.scheduledAt,
  sentAt: h.sentAt,
  errorMessage: null, // not in the search index; the detail page shows it
});
