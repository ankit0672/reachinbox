export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  /** Must exactly match a Redirect URL in the Slack app (https). */
  redirectUrl: string;
  /** Overridable for tests. */
  authorizeUrl?: string;
}

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
// chat:write to post, im:write to open a DM with the user who connected.
export const SLACK_BOT_SCOPES = "chat:write,im:write";

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
  }
}

/** Minimal Slack Web API client (POST, JSON or form, { ok, error } responses). */
export class SlackApi {
  constructor(
    private readonly baseUrl = "https://slack.com/api",
    private readonly timeoutMs = 10_000,
  ) {}

  async call<T extends object>(
    method: string,
    opts: { token?: string; form?: Record<string, string>; json?: object },
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let body: string;
    if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    } else {
      headers["Content-Type"] = "application/json; charset=utf-8";
      body = JSON.stringify(opts.json ?? {});
    }
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = (await res.json()) as T & { ok?: boolean; error?: string };
    if (!data.ok) throw new SlackApiError(method, data.error ?? `http_${res.status}`);
    return data;
  }
}
