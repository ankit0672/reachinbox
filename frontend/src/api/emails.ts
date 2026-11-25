import { apiFetch } from "./client";
import type { EmailListResponse } from "./types";

export type EmailTab = "scheduled" | "sent";

export interface ListEmailsParams {
  status: EmailTab;
  page?: number;
  pageSize?: number;
}

export function listEmails({ status, page = 1, pageSize = 20 }: ListEmailsParams) {
  const qs = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  return apiFetch<EmailListResponse>(`/api/emails?${qs}`);
}
