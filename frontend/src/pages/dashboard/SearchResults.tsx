import { SearchX } from "lucide-react";
import { EmailListView } from "../../emails/EmailListView";
import { PAGE_SIZE, toListState, usePageParam } from "../../emails/listState";
import { useEmailSearch } from "../../emails/queries";
import { fromSearchHit } from "../../emails/rowData";

/** Search hits in the same rows, states and pagination as the tabs. */
export function SearchResults({ q }: { q: string }) {
  const [page, setPage] = usePageParam();
  const query = useEmailSearch(q, page, PAGE_SIZE);

  return (
    <EmailListView
      label="Search results"
      state={toListState(query, fromSearchHit)}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      empty={{
        icon: SearchX,
        title: `No results for “${q}”`,
        hint: "Try another word or address.",
      }}
    />
  );
}
