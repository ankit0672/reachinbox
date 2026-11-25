import { Clock, Send } from "lucide-react";
import { useSearchParams } from "react-router";
import type { EmailTab } from "../../api/emails";
import { EmailListView } from "../../emails/EmailListView";
import { parsePage, toListState } from "../../emails/listState";
import { useEmailList } from "../../emails/queries";
import { fromListItem } from "../../emails/rowData";

export const PAGE_SIZE = 20;

const COPY = {
  scheduled: {
    label: "Scheduled emails",
    empty: {
      icon: Clock,
      title: "No scheduled emails",
      hint: "Compose a campaign to schedule some.",
    },
  },
  sent: {
    label: "Sent emails",
    empty: { icon: Send, title: "No sent emails", hint: "Sent and failed emails show up here." },
  },
} as const;

/** A dashboard tab. The page lives in the URL (?page=N) so it survives reloads. */
export function EmailTabPage({ tab }: { tab: EmailTab }) {
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get("page"));
  // Only the Scheduled tab polls: that's where emails visibly move to Sent.
  const query = useEmailList(tab, page, PAGE_SIZE, tab === "scheduled");

  const setPage = (next: number) =>
    setParams((p) => {
      if (next <= 1) p.delete("page");
      else p.set("page", String(next));
      return p;
    });

  return (
    <EmailListView
      label={COPY[tab].label}
      state={toListState(query, fromListItem)}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      empty={COPY[tab].empty}
    />
  );
}
