import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { formatFullTime } from "../lib/format";
import { fromLocalInputValue, sendLaterPresets, toLocalInputValue } from "../lib/time";

interface SendLaterPopoverProps {
  value: Date | null;
  onDone: (at: Date | null) => void;
  onCancel: () => void;
}

/** Figma "Send Later" popover: date-time picker, presets, Cancel / Done. */
export function SendLaterPopover({ value, onDone, onCancel }: SendLaterPopoverProps) {
  const [draft, setDraft] = useState<Date | null>(value);
  const [now] = useState(() => new Date());
  const presets = sendLaterPresets(now);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onCancel]);

  const same = (a: Date | null, b: Date) => a?.getTime() === b.getTime();

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Send later"
      className="absolute top-full right-0 z-30 mt-2 w-72 rounded-card border border-border bg-surface p-4 shadow-popover"
    >
      <p className="mb-3 text-sm font-medium">Send Later</p>
      <label className="flex items-center gap-2 border-b border-divider pb-2 text-sm">
        <span className="sr-only">Pick date &amp; time</span>
        <input
          type="datetime-local"
          aria-label="Pick date & time"
          value={draft ? toLocalInputValue(draft) : ""}
          onChange={(e) => setDraft(fromLocalInputValue(e.target.value))}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-60"
        />
      </label>

      <ul className="mt-2 flex flex-col">
        {presets.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              aria-pressed={same(draft, p.at)}
              onClick={() => setDraft(p.at)}
              className={`w-full rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-muted ${
                same(draft, p.at) ? "bg-primary-soft font-medium" : ""
              }`}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <p className="mt-2 text-xs text-ink-muted">{formatFullTime(draft.toISOString())}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        {value ? (
          <button
            type="button"
            onClick={() => onDone(null)}
            className="text-xs text-ink-muted underline hover:text-ink"
          >
            Send now instead
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" disabled={!draft} onClick={() => onDone(draft)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
