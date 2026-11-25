import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleAlert, Clock, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client";
import {
  getSenders,
  scheduleCampaign,
  type PartialEnqueueBody,
  type ValidationErrorBody,
} from "../api/schedule";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/toastContext";
import { RecipientsField } from "../compose/RecipientsField";
import { SendLaterPopover } from "../compose/SendLaterPopover";
import {
  emptyCompose,
  mapServerErrors,
  toScheduleRequest,
  validateCompose,
  type ComposeValues,
  type FieldErrors,
} from "../compose/validation";
import { MAX_LEADS_PER_CAMPAIGN } from "../config";
import { emailKeys } from "../emails/queries";
import { formatFullTime } from "../lib/format";
import { plural } from "../lib/leads";
import { useNow } from "../lib/useNow";

interface FormProblem {
  message: string;
  /** Set when the campaign was saved anyway (503 partial enqueue). */
  saved?: boolean;
}

const isDirty = (v: ComposeValues) =>
  v.entries.length > 0 ||
  v.subject.trim() !== "" ||
  v.body.trim() !== "" ||
  v.delaySeconds !== "" ||
  v.hourlyLimit !== "" ||
  v.startAt !== null;

/** Figma "Compose New Email" as a full page (homepage4/5/6). */
export function ComposePage({ maxLeads = MAX_LEADS_PER_CAMPAIGN }: { maxLeads?: number }) {
  const [values, setValues] = useState<ComposeValues>(emptyCompose);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const senders = useQuery({ queryKey: ["senders"], queryFn: getSenders, staleTime: 60_000 });

  const clientErrors = validateCompose(values, maxLeads);
  const errors: FieldErrors = { ...(showErrors ? clientErrors : {}), ...serverErrors };
  const dirty = isDirty(values);

  const set = <K extends keyof ComposeValues>(key: K, value: ComposeValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    // A field edited after a server rejection is the user's fix; drop that message.
    setServerErrors((e) => (Object.keys(e).length ? {} : e));
  };

  // Leaving with unsaved content (reload, tab close) asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const schedule = useMutation({
    mutationFn: scheduleCampaign,
    onSuccess: async (res) => {
      const { accepted, duplicate, invalid } = res.leads;
      toast.success(
        `Scheduled ${plural(accepted, "email")} · ${plural(duplicate, "duplicate")} · ${invalid} invalid skipped.`,
      );
      await queryClient.invalidateQueries({ queryKey: emailKeys.all });
      void navigate("/dashboard");
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) {
        setProblem({ message: "Couldn't reach the server. Nothing was scheduled; try again." });
      } else if (err.status === 400) {
        const { fields, form } = mapServerErrors(err.body as ValidationErrorBody);
        setServerErrors(fields);
        setProblem(form ? { message: form } : null);
      } else if (err.status === 503 && (err.body as PartialEnqueueBody | undefined)?.campaignId) {
        // Rows are committed; resending would create a second campaign.
        void queryClient.invalidateQueries({ queryKey: emailKeys.all });
        setProblem({ message: err.message, saved: true });
      } else {
        setProblem({ message: err.message });
      }
    },
  });

  const submitting = schedule.isPending;
  const locked = submitting || problem?.saved === true;

  const submit = () => {
    if (locked) return; // no double submits
    setShowErrors(true);
    setProblem(null);
    setServerErrors({});
    if (Object.keys(clientErrors).length > 0) return;
    schedule.mutate(toScheduleRequest(values));
  };

  const goBack = () => {
    if (
      dirty &&
      !problem?.saved &&
      !window.confirm("Discard this email? Your changes will be lost.")
    ) {
      return;
    }
    void navigate("/dashboard");
  };

  const startsInPast = values.startAt !== null && values.startAt.getTime() <= now;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 px-4">
        <button
          type="button"
          aria-label="Back to dashboard"
          onClick={goBack}
          className="rounded-control p-1.5 hover:bg-surface-muted"
        >
          <ArrowLeft aria-hidden size={22} />
        </button>
        <h1 className="text-2xl">Compose New Email</h1>

        <div className="relative ml-auto flex items-center gap-3">
          <button
            type="button"
            aria-label="Schedule send time"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((o) => !o)}
            className={`rounded-full p-1.5 hover:bg-surface-muted ${
              values.startAt ? "text-primary" : "text-ink-muted"
            }`}
          >
            <Clock aria-hidden size={20} />
          </button>
          <Button variant="outline" onClick={submit} disabled={locked} aria-busy={submitting}>
            {submitting && <LoaderCircle aria-hidden size={14} className="animate-spin" />}
            {values.startAt ? "Send Later" : "Send"}
          </Button>
          {pickerOpen && (
            <SendLaterPopover
              value={values.startAt}
              onCancel={() => setPickerOpen(false)}
              onDone={(at) => {
                set("startAt", at);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      </header>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto flex w-full max-w-[780px] flex-col gap-1 px-4 pb-10"
      >
        {problem && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-control bg-danger-soft p-3 text-sm text-danger"
          >
            <CircleAlert aria-hidden size={18} className="mt-px shrink-0" />
            <div className="flex-1">
              <p>{problem.message}</p>
              {problem.saved && (
                <Button
                  variant="ghost"
                  className="mt-2 -ml-3"
                  onClick={() => void navigate("/dashboard")}
                >
                  Go to dashboard
                </Button>
              )}
            </div>
          </div>
        )}

        {values.startAt && (
          <p className="mb-2 text-sm text-ink-muted">
            Starts {formatFullTime(values.startAt.toISOString())}
            {startsInPast && (
              <span className="text-chip-scheduled-ink">
                {" "}
                · This time has passed, so sending starts immediately.
              </span>
            )}
          </p>
        )}

        <Row label="From">
          <span className="inline-flex h-9 items-center rounded-control bg-surface-muted px-3 text-sm">
            {senders.data
              ? `Sender pool · ${plural(senders.data.count, "account")}`
              : senders.isError
                ? "Sender pool"
                : "Sender pool · …"}
          </span>
        </Row>

        <RecipientsField
          entries={values.entries}
          onChange={(entries) => set("entries", entries)}
          maxLeads={maxLeads}
          error={errors.recipients}
        />

        <TextRow
          label="Subject"
          placeholder="Subject"
          value={values.subject}
          onChange={(s) => set("subject", s)}
          error={errors.subject}
        />

        <div className="flex flex-wrap items-start gap-x-8 gap-y-2 py-3">
          <NumberField
            label="Delay between 2 emails (seconds)"
            value={values.delaySeconds}
            onChange={(s) => set("delaySeconds", s)}
            error={errors.delay}
            min={1}
            step="any"
          />
          <NumberField
            label="Hourly limit (per sender)"
            value={values.hourlyLimit}
            onChange={(s) => set("hourlyLimit", s)}
            error={errors.hourlyLimit}
            min={1}
            step={1}
          />
        </div>
        {errors.startTime && <p className="text-xs text-danger">{errors.startTime}</p>}

        <BodyField value={values.body} onChange={(s) => set("body", s)} error={errors.body} />
      </form>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3">
      <span className="w-16 shrink-0 text-sm">{label}</span>
      {children}
    </div>
  );
}

interface TextRowProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (s: string) => void;
  error?: string;
}

function TextRow({ label, placeholder, value, onChange, error }: TextRowProps) {
  const id = useId();
  return (
    <div>
      <div className="flex min-h-12 items-center gap-3 border-b border-divider">
        <label htmlFor={id} className="w-16 shrink-0 text-sm">
          {label}
        </label>
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-11 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 pl-19 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (s: string) => void;
  error?: string;
  min: number;
  step: number | "any";
}

function NumberField({ label, value, onChange, error, min, step }: NumberFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          placeholder="00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-9 w-20 rounded-control border bg-surface px-3 text-sm placeholder:text-ink-subtle focus:outline-2 focus:outline-primary ${
            error ? "border-danger" : "border-divider"
          }`}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function BodyField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (s: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Body
      </label>
      <textarea
        id={id}
        value={value}
        placeholder="Type your email…"
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`min-h-[340px] w-full resize-y rounded-card bg-surface-editor p-4 text-sm placeholder:text-ink-subtle focus:outline-2 focus:outline-primary ${
          error ? "outline-2 outline-danger" : ""
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
