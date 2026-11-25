/** Response shapes of the backend endpoints the frontend uses. */

/** GET /api/auth/me */
export interface Me {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export type EmailStatus = "scheduled" | "processing" | "sent" | "failed";

/** One row of GET /api/emails. Dates are ISO-8601 strings (UTC). */
export interface EmailListItem {
  id: string;
  toEmail: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  /** Ethereal preview link, only for sent emails. */
  previewUrl: string | null;
}

/** GET /api/emails?status=scheduled|sent&page=&pageSize= */
export interface EmailListResponse {
  total: number;
  page: number;
  pageSize: number;
  results: EmailListItem[];
}
