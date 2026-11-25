import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppProviders } from "../app/AppProviders";
import { AppRoutes } from "../app/AppRoutes";

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
  });

/**
 * Stubs global fetch with routes keyed by "METHOD /path" (query string
 * ignored). Unknown routes return 404 so a missing stub fails loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.split("?")[0]}`;
    const handler = routes[key];
    return handler ? handler(init) : json(404, { error: `no stub for ${key}` });
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

/** Renders the real routes and providers at a given URL. */
export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
}
