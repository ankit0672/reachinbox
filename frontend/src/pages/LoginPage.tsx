import { CircleAlert } from "lucide-react";
import { useSearchParams } from "react-router";
import { GOOGLE_LOGIN_PATH } from "../api/auth";
import { GoogleIcon } from "../components/GoogleIcon";
import { Button } from "../components/ui/Button";
import { buttonClasses } from "../components/ui/buttonStyles";
import { loginErrorMessage } from "../lib/loginErrors";

const inputClasses =
  "h-14 w-full rounded-control bg-surface-muted px-4 text-sm placeholder:text-ink-muted " +
  "disabled:cursor-not-allowed";

/**
 * Figma "Login" card. Only Google sign-in works: the email/password fields
 * are kept for design fidelity but disabled (README: trade-offs). There is no
 * email login endpoint and no client-side auth logic behind them.
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const error = loginErrorMessage(params.get("error"));

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-[490px] rounded-card border border-border bg-surface px-6 py-12 sm:px-14">
        <h1 className="text-center text-4xl font-bold">Login</h1>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-control bg-danger-soft p-3 text-sm text-danger"
          >
            <CircleAlert aria-hidden size={18} className="mt-px shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* A real navigation, not fetch: the OAuth flow needs full-page redirects. */}
        <a
          href={GOOGLE_LOGIN_PATH}
          className={buttonClasses({ variant: "soft", size: "lg", className: "mt-8 w-full" })}
        >
          <GoogleIcon />
          Login with Google
        </a>

        <div className="my-7 flex items-center gap-4 text-xs text-ink-subtle">
          <span className="h-px flex-1 bg-divider" />
          or sign up through email
          <span className="h-px flex-1 bg-divider" />
        </div>

        <form aria-describedby="email-login-note" onSubmit={(e) => e.preventDefault()}>
          <fieldset disabled className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email ID"
              aria-label="Email ID"
              className={inputClasses}
            />
            <input
              type="password"
              placeholder="Password"
              aria-label="Password"
              className={inputClasses}
            />
            <Button type="submit" size="lg" className="mt-3 w-full">
              Login
            </Button>
          </fieldset>
          <p id="email-login-note" className="mt-3 text-center text-xs text-ink-muted">
            Email login isn't available yet, please use Google.
          </p>
        </form>
      </div>
    </main>
  );
}
