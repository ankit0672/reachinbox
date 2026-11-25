import { LoaderCircle } from "lucide-react";

interface SpinnerProps {
  label?: string;
  size?: number;
}

export function Spinner({ label = "Loading", size = 20 }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-ink-muted">
      <LoaderCircle aria-hidden size={size} className="animate-spin text-primary" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Centred spinner for a whole page or panel. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center">
      <Spinner label={label} size={28} />
    </div>
  );
}
