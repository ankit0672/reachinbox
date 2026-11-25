import { apiFetch } from "./client";
import type { EmailListResponse } from "./types";

export interface ListEmailsParams {
  status: "scheduled" | "sent";
  page?: number;
  pageSize?: number;
}

export function listEmails({ status, page = 1, pageSize = 20 }: ListEmailsParams) {
  const qs = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  return apiFetch<EmailListResponse>(`/api/emails?${qs}`);
}
