import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ApiError, UnauthorizedError } from "../api/client";
import { ToastProvider } from "../components/ui/Toast";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Client errors (4xx) won't fix themselves; retry server/network errors once.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * Query client + toasts. Must sit inside the router: any 401 from any query
 * or mutation drops the cached data and sends the user to /login.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const navigate = useNavigate();

  useEffect(() => {
    const onUnauthorized = (err: unknown) => {
      if (!(err instanceof UnauthorizedError)) return;
      queryClient.clear();
      void navigate("/login", { replace: true });
    };
    const unsubQueries = queryClient.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error") onUnauthorized(e.action.error);
    });
    const unsubMutations = queryClient.getMutationCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error") onUnauthorized(e.action.error);
    });
    return () => {
      unsubQueries();
      unsubMutations();
    };
  }, [queryClient, navigate]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
