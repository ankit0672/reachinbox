import { CircleAlert, Clock, LoaderCircle } from "lucide-react";
import { useId, type ReactNode } from "react";
import { formatChipTime, formatFullTime } from "../lib/format";
import type { EmailRowData } from "./rowData";

const chipBase =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap";

type ChipProps = Pick<EmailRowData, "status" | "scheduledAt" | "sentAt" | "errorMessage">;

/**
 * Figma status chip:
 * - scheduled: orange, with the scheduled time ("Tue 9:15:12 AM")
 * - processing: orange "Sending…"
 * - sent: grey, with the sent time
 * - failed: red "Failed"; the error message is shown in a tooltip
 */
export function StatusChip({ status, scheduledAt, sentAt, errorMessage }: ChipProps) {
  switch (status) {
    case "scheduled":
      return (
        <time
          dateTime={scheduledAt}
          title={`Scheduled for ${formatFullTime(scheduledAt)}`}
          className={`${chipBase} border border-chip-scheduled-ink/40 bg-chip-scheduled text-chip-scheduled-ink`}
        >
          <Clock aria-hidden size={12} />
          {formatChipTime(scheduledAt)}
        </time>
      );
    case "processing":
      return (
        <span
          className={`${chipBase} border border-chip-scheduled-ink/40 bg-chip-scheduled text-chip-scheduled-ink`}
        >
          <LoaderCircle aria-hidden size={12} className="animate-spin" />
          Sending…
        </span>
      );
    case "sent":
      return sentAt ? (
        <time
          dateTime={sentAt}
          title={`Sent ${formatFullTime(sentAt)}`}
          className={`${chipBase} bg-chip-neutral text-ink`}
        >
          Sent {formatChipTime(sentAt)}
        </time>
      ) : (
        <span className={`${chipBase} bg-chip-neutral text-ink`}>Sent</span>
      );
    case "failed":
      return (
        <Tooltip text={errorMessage ?? "Failed after all retry attempts"}>
          <span className={`${chipBase} bg-danger-soft text-danger`}>
            <CircleAlert aria-hidden size={12} />
            Failed
          </span>
        </Tooltip>
      );
  }
}

/** Hover/focus tooltip; the text is also the trigger's accessible description. */
function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  return (
    <span
      tabIndex={0}
      aria-describedby={id}
      className="group relative inline-flex focus:outline-none"
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute top-full left-0 z-20 mt-1 w-max max-w-xs rounded-control bg-ink px-2 py-1 text-xs text-white opacity-0 shadow-popover transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
