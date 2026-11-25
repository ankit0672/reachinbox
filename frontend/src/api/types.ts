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
  /** Body with whitespace collapsed, at most 120 chars + "…". */
  bodyPreview: string;
  /** Final failure reason, only for failed emails. */
  errorMessage: string | null;
}

/** GET /api/emails?status=scheduled|sent&page=&pageSize= */
export interface EmailListResponse {
  total: number;
  page: number;
  pageSize: number;
  results: EmailListItem[];
}

/** One hit of GET /api/search (the Elasticsearch document). */
export interface SearchHit {
  id: string;
  campaignId: string;
  toEmail: string;
  senderEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
}

/** GET /api/search?q=&status=&page=&pageSize= */
export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  results: SearchHit[];
}

/** GET /api/senders */
export interface SendersResponse {
  count: number;
}
