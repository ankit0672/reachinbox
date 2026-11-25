/** The codes the backend appends to /login?error=... (backend/src/routes/auth.ts). */
const MESSAGES: Record<string, string> = {
  access_denied: "Google sign-in was cancelled. Please try again.",
  invalid_state:
    "Your sign-in link expired or was opened in another tab. Please try again.",
  oauth_failed: "Google sign-in failed. Please try again in a moment.",
  google_not_configured: "Google sign-in isn't set up on this server yet.",
};

const FALLBACK = "Sign-in failed. Please try again.";

/** A readable message for a login error code; unknown codes are never echoed. */
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : FALLBACK;
}
