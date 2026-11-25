import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useToast } from "../components/ui/toastContext";
import { slackOutcome, slackStatusKey } from "./slack";

/**
 * After the Slack OAuth round trip the API lands on /dashboard?slack=<outcome>.
 * Show it once as a toast, refetch the status, and drop the parameter so a
 * reload doesn't repeat it.
 */
export function useSlackOutcome() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const handled = useRef<string | null>(null);
  const code = params.get("slack");

  useEffect(() => {
    if (!code || handled.current === code) return; // StrictMode runs effects twice
    handled.current = code;
    const { kind, message } = slackOutcome(code);
    toast[kind](message);
    void queryClient.invalidateQueries({ queryKey: slackStatusKey });
    setParams(
      (p) => {
        p.delete("slack");
        return p;
      },
      { replace: true },
    );
  }, [code, toast, queryClient, setParams]);
}
