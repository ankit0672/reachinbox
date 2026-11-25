import { SearchX } from "lucide-react";
import { useSearchParams } from "react-router";
import { EmailListView } from "../../emails/EmailListView";
import { parsePage, toListState } from "../../emails/listState";
import { useEmailSearch } from "../../emails/queries";
import { fromSearchHit } from "../../emails/rowData";
import { PAGE_SIZE } from "./EmailTabPage";

/** Search hits in the same rows, states and pagination as the tabs. */
export function SearchResults({ q }: { q: string }) {
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get("page"));
  const query = useEmailSearch(q, page, PAGE_SIZE);

  const setPage = (next: number) =>
    setParams((p) => {
      if (next <= 1) p.delete("page");
      else p.set("page", String(next));
      return p;
    });

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
