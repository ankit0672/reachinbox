import { Clock, Send } from "lucide-react";

const COPY = {
  scheduled: { icon: Clock, text: "Your scheduled emails will appear here." },
  sent: { icon: Send, text: "Your sent emails will appear here." },
};

/** M10 placeholder for the tab content; the tables arrive in M11. */
export function TabPlaceholder({ tab }: { tab: keyof typeof COPY }) {
  const { icon: Icon, text } = COPY[tab];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-muted">
      <Icon aria-hidden size={28} className="text-ink-subtle" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
