import { render } from "@testing-library/react";
import type React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { vi } from "vitest";
import type { EmailListItem } from "../api/types";
import { AppProviders } from "../app/AppProviders";
import { AppRoutes } from "../app/AppRoutes";

type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
  });

/**
 * Stubs global fetch with routes keyed by "METHOD /path" (query string
 * ignored for matching; handlers get the full URL). Unknown routes return
 * 404 so a missing stub fails loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.split("?")[0]}`;
    const handler = routes[key];
    return handler
      ? handler(init, new URL(url, "http://localhost"))
      : json(404, { error: `no stub for ${key}` });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const ME = {
  id: "u1",
  name: "Oliver Brown",
  email: "oliver.brown@domain.io",
  avatarUrl: "https://lh3.googleusercontent.com/a/oliver",
};

/** Exposes the router's current URL to tests as data-testid="location". */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location" hidden>{`${pathname}${search}`}</output>;
}

/** Renders the real routes and providers at a given URL. */
export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <AppRoutes />
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );
}

let nextId = 1;
/** A GET /api/emails row with sensible defaults. */
export function emailItem(over: Partial<EmailListItem> = {}): EmailListItem {
  const n = nextId++;
  return {
    id: `e${n}`,
    toEmail: `lead${n}@example.com`,
    subject: `Subject ${n}`,
    scheduledAt: "2026-11-24T09:15:12Z",
    sentAt: null,
    status: "scheduled",
    previewUrl: null,
    bodyPreview: `Preview ${n}`,
    errorMessage: null,
    ...over,
  };
}

/** Stub routes for a signed-in dashboard: /me plus /api/emails backed by two arrays. */
export function dashboardRoutes(
  data: { scheduled?: EmailListItem[]; sent?: EmailListItem[] } = {},
) {
  return {
    "GET /api/auth/me": () => json(200, ME),
    "GET /api/slack/status": () => json(200, { available: true, connected: false }),
    "GET /api/emails": (_init: RequestInit | undefined, url: URL) => {
      const status = url.searchParams.get("status") === "sent" ? "sent" : "scheduled";
      const page = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
      const all = data[status] ?? [];
      const results = all.slice((page - 1) * pageSize, page * pageSize);
      return json(200, { total: all.length, page, pageSize, results });
    },
  };
}

/** Renders one element at `path` with the app's providers (for components with props). */
export function renderWithProviders(ui: React.ReactElement, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}
