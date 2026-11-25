import { apiFetch } from "./client";
import type { SearchResponse } from "./types";

export function searchEmails(q: string, page = 1, pageSize = 20) {
  const qs = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
  return apiFetch<SearchResponse>(`/api/search?${qs}`);
}
