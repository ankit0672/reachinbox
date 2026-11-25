import type { UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
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

/** Rows per page for every email list (tabs and search). */
export const PAGE_SIZE = 20;

/** ?page=N from the URL: a positive integer, else 1. */
export function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** The list page lives in the URL (?page=N) so it survives reloads and back/forward. */
export function usePageParam(): [number, (page: number) => void] {
  const [params, setParams] = useSearchParams();
  const setPage = (next: number) =>
    setParams((p) => {
      if (next <= 1) p.delete("page");
      else p.set("page", String(next));
      return p;
    });
  return [parsePage(params.get("page")), setPage];
}
