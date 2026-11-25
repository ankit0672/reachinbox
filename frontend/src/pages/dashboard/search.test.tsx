import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../../api/types";
import { dashboardRoutes, emailItem, json, mockApi, renderApp } from "../../test/helpers";

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  id: "h1",
  campaignId: "c1",
  toEmail: "olive@example.com",
  senderEmail: "sender1@ethereal.email",
  subject: "Ramit, great to meet you",
  body: "Hi Olive,\n\n  just wanted to follow up on our meeting",
  status: "sent",
  scheduledAt: "2026-11-24T09:00:00Z",
  sentAt: "2026-11-24T09:00:03Z",
  ...over,
});

const searchCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/search?"))
    .map((url) => new URL(url, "http://x").searchParams.get("q"));

function setup(search: (q: string) => Response) {
  return mockApi({
    ...dashboardRoutes({ scheduled: [emailItem({ subject: "Tab row" })] }),
    "GET /api/search": (_init, url) => search(url.searchParams.get("q") ?? ""),
  });
}

describe("search", () => {
  it("debounces typing into one request and shows hits in the same row style", async () => {
    const fetchMock = setup((q) =>
      json(200, { total: 1, page: 1, pageSize: 20, results: q === "olive" ? [hit()] : [] }),
    );
    renderApp("/dashboard");
    await screen.findByText("Tab row");

    await userEvent.type(screen.getByRole("searchbox", { name: "Search emails" }), "olive");
    const results = await screen.findByRole("region", { name: "Search results" });
    const [row] = within(results).getAllByRole("listitem");
    expect(row).toHaveTextContent("To: olive@example.com");
    expect(within(row!).getByText("Ramit, great to meet you")).toHaveClass("font-medium");
    // Body preview is collapsed the same way as the server's bodyPreview.
    expect(within(row!).getByText(/Hi Olive, just wanted to follow up/)).toBeInTheDocument();
    expect(within(row!).getByText(/^Sent /)).toBeInTheDocument();
    expect(screen.queryByText("Tab row")).not.toBeInTheDocument();

    expect(searchCalls(fetchMock)).toEqual(["olive"]); // not one call per keystroke
  });

  it("shows an empty state for no hits", async () => {
    setup(() => json(200, { total: 0, page: 1, pageSize: 20, results: [] }));
    renderApp("/dashboard");
    await userEvent.type(await screen.findByRole("searchbox"), "nothing");
    expect(await screen.findByText("No results for “nothing”")).toBeInTheDocument();
  });

  it("shows the error with a working Retry when search is unavailable", async () => {
    let down = true;
    setup(() =>
      down
        ? json(503, { error: "Search is temporarily unavailable" })
        : json(200, { total: 1, page: 1, pageSize: 20, results: [hit()] }),
    );
    renderApp("/dashboard");
    await userEvent.type(await screen.findByRole("searchbox"), "olive");
    expect(
      await screen.findByText("Search is temporarily unavailable", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    down = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ramit, great to meet you")).toBeInTheDocument();
  });

  it("the clear button (and emptying the box) goes back to the tab list", async () => {
    setup(() => json(200, { total: 1, page: 1, pageSize: 20, results: [hit()] }));
    renderApp("/dashboard");
    const box = await screen.findByRole("searchbox");
    await userEvent.type(box, "olive");
    await screen.findByText("Ramit, great to meet you");

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box).toHaveValue("");
    expect(await screen.findByText("Tab row")).toBeInTheDocument();

    await userEvent.type(box, "olive");
    await screen.findByText("Ramit, great to meet you");
    await userEvent.clear(box);
    await waitFor(() => expect(screen.getByText("Tab row")).toBeInTheDocument());
  });

  it("opens directly on ?q= from the URL", async () => {
    setup(() => json(200, { total: 1, page: 1, pageSize: 20, results: [hit()] }));
    renderApp("/dashboard?q=olive");
    expect(await screen.findByText("Ramit, great to meet you")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("olive");
  });
});
