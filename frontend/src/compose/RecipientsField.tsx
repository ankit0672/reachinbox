import { Upload, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useToast } from "../components/ui/toastContext";
import {
  extractAddresses,
  formatLeadSummary,
  isValidEmail,
  normalizeEmail,
  splitTokens,
  summarizeLeads,
} from "../lib/leads";

const VISIBLE_CHIPS = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".csv,.txt,text/csv,text/plain";

interface RecipientsFieldProps {
  entries: string[];
  onChange: (entries: string[]) => void;
  maxLeads: number;
  error?: string;
}

/**
 * Figma "To" row: recipient chips with a "+N" overflow, a text input that
 * accepts Enter / comma / paste, and "Upload List" for CSV/TXT files. Under
 * it: "N valid · N duplicates · N invalid", plus a warning over the limit.
 */
export function RecipientsField({ entries, onChange, maxLeads, error }: RecipientsFieldProps) {
  const [text, setText] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const inputId = useId();
  const summaryId = useId();
  const errorId = useId();

  const summary = useMemo(() => summarizeLeads(entries), [entries]);
  const shown = expanded ? summary.valid : summary.valid.slice(0, VISIBLE_CHIPS);
  const hidden = summary.valid.length - shown.length;
  const overLimit = summary.total > maxLeads;

  /** Adds valid typed tokens; invalid ones stay in the box with a message. */
  const commit = (raw: string) => {
    const tokens = splitTokens(raw);
    if (tokens.length === 0) return;
    const good = tokens.filter(isValidEmail);
    const bad = tokens.filter((t) => !isValidEmail(t));
    if (good.length) onChange([...entries, ...good]);
    setText(bad.join(", "));
    setTypedError(
      bad.length
        ? `“${bad[0]}” isn't a valid email address${bad.length > 1 ? " (and others)" : ""}.`
        : null,
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Backspace" && text === "" && summary.valid.length > 0) {
      remove(summary.valid[summary.valid.length - 1]!);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (/[\s,;]/.test(pasted.trim())) {
      e.preventDefault();
      commit(`${text} ${pasted}`);
    }
  };

  const remove = (address: string) =>
    onChange(entries.filter((e) => normalizeEmail(e) !== address));

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ""; // allow re-uploading the same file
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error("Upload a .csv or .txt file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("That file is larger than 5 MB.");
      return;
    }
    const found = extractAddresses(await file.text());
    if (found.length === 0) {
      toast.error(`No email addresses found in ${file.name}.`);
      return;
    }
    onChange([...entries, ...found]);
    toast.success(
      `Added ${found.length} address${found.length === 1 ? "" : "es"} from ${file.name}.`,
    );
  };

  const describedBy = [entries.length ? summaryId : "", error || typedError ? errorId : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <div className="flex min-h-12 items-center gap-3 border-b border-divider">
        <label htmlFor={inputId} className="w-16 shrink-0 text-sm">
          To
        </label>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-2">
          {shown.map((address) => (
            <span
              key={address}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/40 bg-primary-soft pr-1 pl-2 text-xs"
            >
              {address}
              <button
                type="button"
                aria-label={`Remove ${address}`}
                onClick={() => remove(address)}
                className="rounded-full p-0.5 text-ink-muted hover:bg-surface hover:text-ink"
              >
                <X aria-hidden size={12} />
              </button>
            </span>
          ))}
          {(hidden > 0 || expanded) && summary.valid.length > VISIBLE_CHIPS && (
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              className="inline-flex h-6 items-center rounded-full border border-primary/40 bg-primary-soft px-2 text-xs font-medium"
            >
              {expanded ? "Show less" : `+${hidden}`}
            </button>
          )}
          <input
            id={inputId}
            type="text"
            inputMode="email"
            autoComplete="off"
            placeholder={summary.valid.length ? "" : "recipient@example.com"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTypedError(null);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => commit(text)}
            aria-invalid={Boolean(error || typedError)}
            aria-describedby={describedBy || undefined}
            className="h-8 min-w-28 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex shrink-0 items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Upload aria-hidden size={16} />
          Upload List
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          aria-label="Upload a CSV or TXT list of recipients"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>

      {entries.length > 0 && (
        <p
          id={summaryId}
          className="mt-1.5 pl-19 text-xs text-ink-muted"
          title={
            summary.invalid.length
              ? `Invalid: ${summary.invalid.slice(0, 10).join(", ")}`
              : undefined
          }
        >
          {formatLeadSummary(summary)}
        </p>
      )}
      {overLimit && (
        <p role="alert" className="mt-1 pl-19 text-xs text-danger">
          This list has {summary.total} addresses; the limit is {maxLeads} per campaign (duplicates
          and invalid entries count too). Remove some before sending.
        </p>
      )}
      {(typedError || (error && !overLimit)) && (
        <p id={errorId} className="mt-1 pl-19 text-xs text-danger">
          {typedError ?? error}
        </p>
      )}
    </div>
  );
}
