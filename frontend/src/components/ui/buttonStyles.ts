export type ButtonVariant = "primary" | "soft" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Figma: solid green "Login"
  primary: "rounded-control bg-primary px-4 text-white enabled:hover:bg-primary-hover",
  // Figma: pale green "Login with Google"
  soft: "rounded-control bg-primary-soft px-4 text-ink enabled:hover:bg-primary-soft-hover",
  // Figma: green outline pill "Compose" / "Send"
  outline:
    "rounded-full border border-primary bg-surface px-4 text-primary enabled:hover:bg-primary-soft",
  // Plain text action ("Cancel", menu items)
  ghost: "rounded-control px-3 text-ink enabled:hover:bg-surface-muted",
};

const sizes: Record<ButtonSize, string> = { sm: "h-8", md: "h-9", lg: "h-12" };

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Class string for a button look; also used for links styled as buttons. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
}: ButtonStyleOptions = {}) {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim();
}
