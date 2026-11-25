import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listEmails, type EmailTab } from "../api/emails";

/** Every email-related query lives under ["emails"], so one invalidate refreshes them all. */
export const emailKeys = {
  all: ["emails"] as const,
  list: (tab: EmailTab, page: number, pageSize: number) =>
    ["emails", "list", tab, page, pageSize] as const,
  count: (tab: EmailTab) => ["emails", "count", tab] as const,
  search: (q: string, page: number, pageSize: number) =>
    ["emails", "search", q, page, pageSize] as const,
};

/** Live view: the Scheduled tab polls so emails can be seen moving to Sent. */
export const LIVE_REFRESH_MS = 10_000;

/**
 * One page of a tab. `live` turns on polling; TanStack pauses interval
 * refetches while the browser tab is hidden (refetchIntervalInBackground is off).
 */
export function useEmailList(tab: EmailTab, page: number, pageSize: number, live = false) {
  return useQuery({
    queryKey: emailKeys.list(tab, page, pageSize),
    queryFn: () => listEmails({ status: tab, page, pageSize }),
    placeholderData: keepPreviousData, // no flash of the loading state when paging
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

/** Sidebar count: the tab's total from a 1-row page. */
export function useEmailCount(tab: EmailTab, live = false) {
  return useQuery({
    queryKey: emailKeys.count(tab),
    queryFn: () => listEmails({ status: tab, page: 1, pageSize: 1 }),
    select: (res) => res.total,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}
