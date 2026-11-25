/**
 * The only place the frontend talks to the backend. Paths are relative
 * (/api/...): in dev Vite proxies them to the API, in production the same
 * origin serves both, so no backend URL is ever hard-coded.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** 401: the session cookie is missing, expired or invalid. */
export class UnauthorizedError extends ApiError {
  constructor(body: unknown) {
    super(401, "Not authenticated", body);
    this.name = "UnauthorizedError";
  }
}

export async function apiFetch<T>(path: `/api/${string}`, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const body: unknown = await readBody(res);

  if (res.status === 401) throw new UnauthorizedError(body);
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status), body);
  return body as T;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `Request failed (${status})`;
}
