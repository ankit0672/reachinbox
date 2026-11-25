import { CloudOff } from "lucide-react";
import { Navigate, Outlet } from "react-router";
import { UnauthorizedError } from "../api/client";
import { Button } from "../components/ui/Button";
import { PageSpinner } from "../components/ui/Spinner";
import { useMe } from "./useMe";

/**
 * Route guard: renders the child routes only for a signed-in user.
 * 401 -> /login. Any other failure (API down, proxy error) shows a retry
 * instead, so a backend outage is not mistaken for being logged out.
 */
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <PageSpinner label="Checking your session" />;
  if (me.error instanceof UnauthorizedError) return <Navigate to="/login" replace />;
  if (me.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <CloudOff aria-hidden size={32} className="text-ink-subtle" />
        <p className="font-medium">Can't reach the server.</p>
        <p className="text-sm text-ink-muted">Check that the API is running, then try again.</p>
        <Button variant="outline" onClick={() => void me.refetch()} disabled={me.isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  return <Outlet />;
}
