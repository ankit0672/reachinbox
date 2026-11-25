import { ArrowLeft, CircleAlert, CloudOff, ExternalLink, MailX } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import type { EmailDetail } from "../api/types";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { buttonClasses } from "../components/ui/buttonStyles";
import { PageSpinner } from "../components/ui/Spinner";
import { useEmail } from "../emails/queries";
import { StatusChip } from "../emails/StatusChip";
import { formatFullTime } from "../lib/format";

/** Figma email view (homepage3), read-only: no archive, delete or attachments. */
export function EmailDetailPage() {
  const { id = "" } = useParams();
  const email = useEmail(id);
  const navigate = useNavigate();
  const location = useLocation();

  // Back to wherever the user came from (keeps tab, page and search); else the dashboard.
  const goBack = () =>
    location.key !== "default" ? void navigate(-1) : void navigate("/dashboard");

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 px-4">
        <button
          type="button"
          aria-label="Back"
          onClick={goBack}
          className="rounded-control p-1.5 hover:bg-surface-muted"
        >
          <ArrowLeft aria-hidden size={22} />
        </button>
        <h1 className="min-w-0 truncate text-2xl">{email.data?.subject ?? "Email"}</h1>
      </header>

      <div className="mx-auto w-full max-w-[800px] px-4 pb-10">
        {email.isPending && <PageSpinner label="Loading email" />}
        {email.isError &&
          (email.error instanceof ApiError && email.error.status === 404 ? (
            <Centered icon={MailX} title="Email not found">
              <Link to="/dashboard" className={buttonClasses({ variant: "outline" })}>
                Back to dashboard
              </Link>
            </Centered>
          ) : (
            <Centered icon={CloudOff} title="Couldn't load this email." hint={email.error.message}>
              <Button variant="outline" onClick={() => void email.refetch()}>
                Retry
              </Button>
            </Centered>
          ))}
        {email.data && <EmailBody email={email.data} />}
      </div>
    </div>
  );
}

function EmailBody({ email }: { email: EmailDetail }) {
  return (
    <article className="flex flex-col gap-5 pt-2">
      <div className="flex items-start gap-3">
        <Avatar name={email.toEmail} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">To: {email.toEmail}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            <dt>Scheduled</dt>
            <dd>{formatFullTime(email.scheduledAt)}</dd>
            {email.sentAt && (
              <>
                <dt>Sent</dt>
                <dd>{formatFullTime(email.sentAt)}</dd>
              </>
            )}
            {email.failedAt && (
              <>
                <dt>Failed</dt>
                <dd>{formatFullTime(email.failedAt)}</dd>
              </>
            )}
          </dl>
        </div>
        <StatusChip {...email} />
      </div>

      {email.status === "failed" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control bg-danger-soft p-3 text-sm text-danger"
        >
          <CircleAlert aria-hidden size={18} className="mt-px shrink-0" />
          <p>
            <span className="font-medium">Sending failed after all retries.</span>{" "}
            {email.errorMessage ?? "No error message was recorded."}
          </p>
        </div>
      )}

      <div className="rounded-card bg-surface-editor p-5 text-sm leading-6 whitespace-pre-wrap">
        {email.body}
      </div>

      {email.previewUrl && (
        <a
          href={email.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
        >
          Open the Ethereal preview
          <ExternalLink aria-hidden size={14} />
        </a>
      )}
    </article>
  );
}

function Centered({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof MailX;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-2 text-center">
      <Icon aria-hidden size={28} className="text-ink-subtle" />
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-ink-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
