import type { UseQueryResult } from "@tanstack/react-query";
import type { EmailListState } from "./EmailListView";
import type { EmailRowData } from "./rowData";

interface Paged<T> {
  total: number;
  results: T[];
}

/** Adapts any paged query (tab list or search) to the shared list view. */
export function toListState<T>(
  query: UseQueryResult<Paged<T>>,
  toRow: (item: T) => EmailRowData,
): EmailListState {
  return {
    status: query.status,
    rows: query.data?.results.map(toRow) ?? [],
    total: query.data?.total ?? 0,
    error: query.error,
    isRefetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

/** ?page=N from the URL: a positive integer, else 1. */
export function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
