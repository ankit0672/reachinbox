import type { EmailRowData } from "./rowData";
import { StatusChip } from "./StatusChip";

/** Figma row: "To: address", status chip, bold subject, grey body preview. */
export function EmailRow({ email }: { email: EmailRowData }) {
  return (
    <li className="flex h-14 items-center gap-4 border-b border-row-divider px-4 text-sm">
      <span className="w-56 shrink-0 truncate" title={email.toEmail}>
        To: {email.toEmail}
      </span>
      <StatusChip {...email} />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium">{email.subject}</span>
        {email.preview && <span className="text-ink-muted"> - {email.preview}</span>}
      </p>
    </li>
  );
}
