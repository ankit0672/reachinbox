import { Clock, Send } from "lucide-react";
import type { EmailTab } from "../../api/emails";
import { EmailListView } from "../../emails/EmailListView";
import { PAGE_SIZE, toListState, usePageParam } from "../../emails/listState";
import { useEmailList } from "../../emails/queries";
import { fromListItem } from "../../emails/rowData";

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

/** A dashboard tab: one page of Scheduled or Sent. */
export function EmailTabPage({ tab }: { tab: EmailTab }) {
  const [page, setPage] = usePageParam();
  // Only the Scheduled tab polls: that's where emails visibly move to Sent.
  const query = useEmailList(tab, page, PAGE_SIZE, tab === "scheduled");

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
