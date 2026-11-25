import { CloudOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { Pagination } from "../components/ui/Pagination";
import { EmailRow } from "./EmailRow";
import type { EmailRowData } from "./rowData";

export interface EmailListState {
  status: "pending" | "error" | "success";
  rows: EmailRowData[];
  total: number;
  error: Error | null;
  isRefetching: boolean;
  refetch: () => void;
}

interface EmailListViewProps {
  label: string;
  state: EmailListState;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  empty: { icon: LucideIcon; title: string; hint?: string };
}

/**
 * The one list used by the Scheduled tab, the Sent tab and search results:
 * loading skeleton, error with retry, empty state, rows and pagination.
 */
export function EmailListView({
  label,
  state,
  page,
  pageSize,
  onPageChange,
  empty,
}: EmailListViewProps) {
  if (state.status === "pending") return <SkeletonRows label={label} />;

  if (state.status === "error") {
    return (
      <CenteredMessage
        icon={CloudOff}
        title={`Couldn't load ${label.toLowerCase()}.`}
        hint={state.error?.message}
      >
        <Button variant="outline" onClick={state.refetch} disabled={state.isRefetching}>
          Retry
        </Button>
      </CenteredMessage>
    );
  }

  if (state.rows.length === 0 && page <= 1) {
    return <CenteredMessage icon={empty.icon} title={empty.title} hint={empty.hint} />;
  }

  return (
    <section aria-label={label}>
      <ul aria-busy={state.isRefetching}>
        {state.rows.map((email) => (
          <EmailRow key={email.id} email={email} />
        ))}
      </ul>
      {state.rows.length === 0 && (
        <p className="px-4 py-6 text-sm text-ink-muted">Nothing on this page.</p>
      )}
      <Pagination page={page} pageSize={pageSize} total={state.total} onPageChange={onPageChange} />
    </section>
  );
}

function SkeletonRows({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label.toLowerCase()}`}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-4 border-b border-row-divider px-4">
          <span className="h-3 w-40 animate-pulse rounded-full bg-surface-muted" />
          <span className="h-5 w-28 animate-pulse rounded-full bg-surface-muted" />
          <span className="h-3 flex-1 animate-pulse rounded-full bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

interface CenteredMessageProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children?: ReactNode;
}

function CenteredMessage({ icon: Icon, title, hint, children }: CenteredMessageProps) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon aria-hidden size={28} className="text-ink-subtle" />
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-md text-sm text-ink-muted">{hint}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
