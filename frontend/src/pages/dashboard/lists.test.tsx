import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardRoutes, emailItem, json, mockApi, renderApp } from "../../test/helpers";

// Wednesday 2026-11-25 12:00 UTC (tests run in UTC); only Date is faked.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const list = (name: RegExp) => screen.findByRole("region", { name });
const emailCalls = (fetchMock: ReturnType<typeof mockApi>, status: string) =>
  fetchMock.mock.calls.filter(
    ([url]) => String(url).startsWith("/api/emails?") && String(url).includes(`status=${status}`),
  );

describe("Scheduled tab", () => {
  it("renders rows like the Figma: To, orange time chip, bold subject, grey preview", async () => {
    mockApi(
      dashboardRoutes({
        scheduled: [
          emailItem({
            toEmail: "john@example.com",
            subject: "Meeting follow-up",
            bodyPreview: "Hi John, just wanted to follow up",
            scheduledAt: "2026-11-24T09:15:12Z",
          }),
          emailItem({ toEmail: "olive@example.com", status: "processing" }),
        ],
      }),
    );
    renderApp("/dashboard");
    const rows = within(await list(/scheduled emails/i)).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent("To: john@example.com");
    const chip = within(rows[0]!).getByText("Tue 9:15:12 AM");
    expect(chip).toHaveAttribute("dateTime", "2026-11-24T09:15:12Z");
    expect(chip).toHaveClass("bg-chip-scheduled");
    expect(within(rows[0]!).getByText("Meeting follow-up")).toHaveClass("font-medium");
    expect(within(rows[0]!).getByText(/Hi John, just wanted/)).toHaveClass("text-ink-muted");

    expect(within(rows[1]!).getByText("Sending…")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockApi(dashboardRoutes());
    renderApp("/dashboard");
    expect(await screen.findByText("No scheduled emails")).toBeInTheDocument();
  });

  it("shows an error with a working Retry", async () => {
    let fail = true;
    const routes = dashboardRoutes({ scheduled: [emailItem({ subject: "Back again" })] });
    mockApi({
      ...routes,
      "GET /api/emails": (init, url) =>
        fail && url.searchParams.get("pageSize") === "20"
          ? json(500, { error: "Internal server error" })
          : routes["GET /api/emails"](init, url),
    });
    renderApp("/dashboard");
    expect(
      await screen.findByText("Couldn't load scheduled emails.", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Back again")).toBeInTheDocument();
  });

  it("paginates with the page in the URL (?page=N)", async () => {
    const scheduled = Array.from({ length: 45 }, (_, i) => emailItem({ subject: `Bulk ${i + 1}` }));
    mockApi(dashboardRoutes({ scheduled }));
    renderApp("/dashboard");
    expect(await screen.findByText("Bulk 1")).toBeInTheDocument();
    expect(screen.getByText("1–20 of 45")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Bulk 21")).toBeInTheDocument();
    expect(screen.getByText("21–40 of 45")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Bulk 45")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("opens directly on ?page=2", async () => {
    const scheduled = Array.from({ length: 25 }, (_, i) => emailItem({ subject: `Bulk ${i + 1}` }));
    mockApi(dashboardRoutes({ scheduled }));
    renderApp("/dashboard?page=2");
    expect(await screen.findByText("Bulk 21")).toBeInTheDocument();
    expect(screen.queryByText("Bulk 1")).not.toBeInTheDocument();
  });
});

describe("Sent tab", () => {
  it("sent rows get a grey chip with the sent time; failed rows a red chip with the error as tooltip", async () => {
    mockApi(
      dashboardRoutes({
        sent: [
          emailItem({
            status: "sent",
            sentAt: "2026-11-25T08:15:12Z",
            subject: "Re: Project Update",
          }),
          emailItem({ status: "failed", errorMessage: "SMTP 421 service not available" }),
        ],
      }),
    );
    renderApp("/dashboard/sent");
    const rows = within(await list(/sent emails/i)).getAllByRole("listitem");

    const sentChip = within(rows[0]!).getByText("Sent Wed 8:15:12 AM");
    expect(sentChip).toHaveClass("bg-chip-neutral");

    const failed = within(rows[1]!).getByText("Failed");
    expect(failed).toHaveClass("text-danger");
    const tooltip = within(rows[1]!).getByRole("tooltip");
    expect(tooltip).toHaveTextContent("SMTP 421 service not available");
    expect(failed.closest("[aria-describedby]")).toHaveAccessibleDescription(
      "SMTP 421 service not available",
    );
  });

  it("shows the empty state", async () => {
    mockApi(dashboardRoutes());
    renderApp("/dashboard/sent");
    expect(await screen.findByText("No sent emails")).toBeInTheDocument();
  });
});

describe("sidebar counts and refresh", () => {
  it("shows each tab's total next to it", async () => {
    mockApi(
      dashboardRoutes({
        scheduled: [emailItem(), emailItem(), emailItem()],
        sent: [emailItem({ status: "sent", sentAt: "2026-11-25T08:00:00Z" })],
      }),
    );
    renderApp("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Mailboxes" });
    expect(await within(nav).findByLabelText("3 scheduled")).toHaveTextContent("3");
    expect(await within(nav).findByLabelText("1 sent")).toHaveTextContent("1");
  });

  it("the refresh button refetches the list and the counts", async () => {
    const fetchMock = mockApi(dashboardRoutes({ scheduled: [emailItem({ subject: "Only one" })] }));
    renderApp("/dashboard");
    await screen.findByText("Only one");
    await waitFor(() => expect(emailCalls(fetchMock, "sent")).toHaveLength(1));
    const before = emailCalls(fetchMock, "scheduled").length;

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(emailCalls(fetchMock, "scheduled").length).toBe(before + 2));
    expect(emailCalls(fetchMock, "sent")).toHaveLength(2);
  });
});

describe("live refresh", () => {
  it("the Scheduled tab refetches every 10 s; the Sent tab does not", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    const fetchMock = mockApi(dashboardRoutes({ scheduled: [emailItem({ subject: "Live" })] }));
    renderApp("/dashboard");
    await screen.findByText("Live");
    const listCalls = () =>
      emailCalls(fetchMock, "scheduled").filter(([url]) => String(url).includes("pageSize=20"));
    expect(listCalls()).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(10_500));
    await waitFor(() => expect(listCalls()).toHaveLength(2));

    await userEvent.click(screen.getByRole("link", { name: /^Sent/ }));
    await screen.findByText("No sent emails");
    const sentListCalls = () =>
      emailCalls(fetchMock, "sent").filter(([url]) => String(url).includes("pageSize=20"));
    const sentBefore = sentListCalls().length;
    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(sentListCalls()).toHaveLength(sentBefore);
  });
});
