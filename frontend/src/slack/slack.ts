import { useQuery } from "@tanstack/react-query";
import { getSlackStatus } from "../api/slack";

export const slackStatusKey = ["slack", "status"] as const;

export function useSlackStatus() {
  return useQuery({ queryKey: slackStatusKey, queryFn: getSlackStatus, staleTime: 60_000 });
}

/** The outcomes the API appends to /dashboard?slack=... (backend/src/routes/slack.ts). */
const OUTCOMES: Record<string, { kind: "success" | "error"; message: string }> = {
  connected: {
    kind: "success",
    message: "Slack connected. Rate-limit alerts will arrive as a DM.",
  },
  denied: { kind: "error", message: "Slack connection was cancelled." },
  invalid_state: {
    kind: "error",
    message: "That Slack link expired or was already used. Try Connect Slack again.",
  },
  error: { kind: "error", message: "Couldn't connect Slack. Please try again." },
  not_configured: { kind: "error", message: "Slack isn't set up on this server." },
};

/** Toast for a ?slack= outcome; unknown codes get a generic message and are never echoed. */
export function slackOutcome(code: string): { kind: "success" | "error"; message: string } {
  return Object.hasOwn(OUTCOMES, code)
    ? OUTCOMES[code]!
    : { kind: "error", message: "Slack connection didn't complete. Please try again." };
}
