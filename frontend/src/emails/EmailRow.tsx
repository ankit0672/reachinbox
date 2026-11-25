import { Link } from "react-router";
import type { EmailRowData } from "./rowData";
import { StatusChip } from "./StatusChip";

/** Figma row: "To: address", status chip, bold subject, grey body preview. Opens the email. */
export function EmailRow({ email }: { email: EmailRowData }) {
  return (
    <li className="border-b border-row-divider">
      <Link
        to={`/emails/${email.id}`}
        className="flex h-14 items-center gap-4 px-4 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span className="w-56 shrink-0 truncate" title={email.toEmail}>
          To: {email.toEmail}
        </span>
        <StatusChip {...email} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{email.subject}</span>
          {email.preview && <span className="text-ink-muted"> - {email.preview}</span>}
        </span>
      </Link>
    </li>
  );
}
