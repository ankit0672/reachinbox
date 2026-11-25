import { apiFetch } from "./client";

/** GET /api/slack/status. Never includes the token. */
export interface SlackStatus {
  /** false when the server has no Slack app configured. */
  available: boolean;
  connected: boolean;
  teamName?: string;
  connectedAt?: string;
}

/** Full-page navigation target: the API redirects to Slack's consent screen. */
export const SLACK_CONNECT_PATH = "/api/slack/connect";

export const getSlackStatus = () => apiFetch<SlackStatus>("/api/slack/status");

export const disconnectSlack = () => apiFetch<void>("/api/slack/disconnect", { method: "DELETE" });
