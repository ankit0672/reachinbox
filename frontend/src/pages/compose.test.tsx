import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleRequest } from "../api/schedule";
import { toIsoWithOffset } from "../lib/time";
import { dashboardRoutes, json, mockApi, renderApp, renderWithProviders } from "../test/helpers";
import { ComposePage } from "./ComposePage";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const created = {
  campaignId: "c1",
  count: 3,
  leads: { received: 5, accepted: 3, duplicate: 1, invalid: 1 },
  invalidLeads: ["bad@"],
  firstScheduledAt: "2026-11-26T04:30:00.000Z",
  lastScheduledAt: "2026-11-26T04:30:04.000Z",
};

function api(schedule: (body: ScheduleRequest) => Response = () => json(201, created)) {
  return mockApi({
    ...dashboardRoutes(),
    "GET /api/senders": () => json(200, { count: 3 }),
    "POST /api/schedule": (init) => schedule(JSON.parse(String(init?.body)) as ScheduleRequest),
  });
}

const postedBodies = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === "/api/schedule" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as ScheduleRequest);

const to = () => screen.getByLabelText("To");
const sendButton = () => screen.getByRole("button", { name: /^Send( Later)?$/ });

async function fillValidForm(user = userEvent.setup()) {
  await user.type(to(), "a@x.io, b@x.io{Enter}");
  await user.type(screen.getByLabelText("Subject"), "Quarterly update");
  await user.type(screen.getByLabelText("Delay between 2 emails (seconds)"), "2");
  await user.type(screen.getByLabelText("Hourly limit (per sender)"), "1");
  await user.type(screen.getByLabelText("Body"), "Hi there");
  return user;
}

describe("compose page", () => {
  it("is a full page with the read-only sender pool", async () => {
    api();
    renderApp("/compose");
    expect(await screen.findByRole("heading", { name: "Compose New Email" })).toBeInTheDocument();
    expect(await screen.findByText("Sender pool · 3 accounts")).toBeInTheDocument();
  });

  it("validates inline and does not call the API", async () => {
    const fetchMock = api();
    renderApp("/compose");
    await userEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect(screen.getByText("Add at least one valid recipient.")).toBeInTheDocument();
    expect(screen.getByText("Subject is required.")).toBeInTheDocument();
    expect(screen.getByText("Write the email body.")).toBeInTheDocument();
    expect(screen.getByText("Enter the delay in seconds.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveAttribute("aria-invalid", "true");
    expect(postedBodies(fetchMock)).toHaveLength(0);
  });

  it("delay below 1 second and a fractional limit are rejected", async () => {
    api();
    renderApp("/compose");
    await screen.findByLabelText("To");
    await fillValidForm();
    const delay = screen.getByLabelText("Delay between 2 emails (seconds)");
    await userEvent.clear(delay);
    await userEvent.type(delay, "0.5");
    const limit = screen.getByLabelText("Hourly limit (per sender)");
    await userEvent.clear(limit);
    await userEvent.type(limit, "1.5");
    await userEvent.click(sendButton());
    expect(screen.getByText("At least 1 second.")).toBeInTheDocument();
    expect(screen.getAllByText("Enter a whole number.")).toHaveLength(1);
  });
});

describe("recipients", () => {
  it("typed addresses become chips; invalid ones stay in the box with a message", async () => {
    api();
    renderApp("/compose");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("To"), "a@x.io,");
    await user.type(to(), "not-an-email{Enter}");
    expect(screen.getByRole("button", { name: "Remove a@x.io" })).toBeInTheDocument();
    expect(to()).toHaveValue("not-an-email");
    expect(screen.getByText("“not-an-email” isn't a valid email address.")).toBeInTheDocument();
  });

  it("pasting a list adds every address", async () => {
    api();
    renderApp("/compose");
    const input = await screen.findByLabelText("To");
    input.focus();
    await userEvent.paste("b@x.io c@x.io; B@X.IO");
    expect(screen.getByText("2 valid · 1 duplicate · 0 invalid")).toBeInTheDocument();
  });

  it("Upload List parses a CSV, counts duplicates and invalid, and overflows to +N", async () => {
    api();
    renderApp("/compose");
    await screen.findByLabelText("To");
    const csv =
      "name,email\nTame,tame@jmail.com\nLame,lame@jmail.com\nDame,dame@jmail.com\n" +
      "Ann,ann@jmail.com\nTame again,TAME@jmail.com\nBroken,broken@\n";
    await userEvent.upload(
      screen.getByLabelText("Upload a CSV or TXT list of recipients"),
      new File([csv], "leads.csv", { type: "text/csv" }),
    );
    expect(await screen.findByText("4 valid · 1 duplicate · 1 invalid")).toBeInTheDocument();
    expect(screen.getByText("Added 6 addresses from leads.csv.")).toBeInTheDocument();
    // Figma: three chips then "+N".
    expect(screen.getByRole("button", { name: "Remove tame@jmail.com" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove ann@jmail.com" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+1" }));
    expect(screen.getByRole("button", { name: "Remove ann@jmail.com" })).toBeInTheDocument();
  });

  it("warns clearly and blocks sending over MAX_LEADS_PER_CAMPAIGN", async () => {
    const fetchMock = api();
    renderWithProviders(<ComposePage maxLeads={3} />, "/compose");
    await fillValidForm();
    await userEvent.upload(
      screen.getByLabelText("Upload a CSV or TXT list of recipients"),
      new File(["c@x.io\nd@x.io"], "more.txt", { type: "text/plain" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This list has 4 addresses; the limit is 3 per campaign",
    );
    await userEvent.click(sendButton());
    expect(postedBodies(fetchMock)).toHaveLength(0);
  });
});

describe("Send / Send Later", () => {
  it("the button says Send until a start time is chosen, then Send Later", async () => {
    api();
    renderApp("/compose");
    expect(await screen.findByRole("button", { name: "Send" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Schedule send time" }));
    const picker = screen.getByRole("dialog", { name: "Send later" });
    for (const label of [
      "Tomorrow",
      "Tomorrow, 10:00 AM",
      "Tomorrow, 11:00 AM",
      "Tomorrow, 3:00 PM",
    ]) {
      expect(within(picker).getByRole("button", { name: label })).toBeInTheDocument();
    }
    await userEvent.click(within(picker).getByRole("button", { name: "Tomorrow, 10:00 AM" }));
    await userEvent.click(within(picker).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Send Later" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Schedule send time" }));
    await userEvent.click(screen.getByRole("button", { name: "Send now instead" }));
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("Cancel keeps the previous choice", async () => {
    api();
    renderApp("/compose");
    await userEvent.click(await screen.findByRole("button", { name: "Schedule send time" }));
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow, 3:00 PM" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("a time in the past shows that sending starts immediately", async () => {
    api();
    renderApp("/compose");
    await userEvent.click(await screen.findByRole("button", { name: "Schedule send time" }));
    fireEvent.change(screen.getByLabelText("Pick date & time"), {
      target: { value: "2020-01-01T09:00" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText(/this time has passed, so sending starts immediately/i)).toBeVisible();
  });

  it("posts startTime as ISO with the browser's offset (+05:30 in India)", async () => {
    process.env.TZ = "Asia/Kolkata";
    const fetchMock = api();
    renderApp("/compose");
    await screen.findByLabelText("To");
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "Schedule send time" }));
    await user.click(screen.getByRole("button", { name: "Tomorrow, 10:00 AM" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Send Later" }));

    await waitFor(() => expect(postedBodies(fetchMock)).toHaveLength(1));
    const body = postedBodies(fetchMock)[0]!;
    expect(body.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T10:00:00\+05:30$/);
    expect(body).toMatchObject({
      subject: "Quarterly update",
      body: "Hi there",
      delayBetweenMs: 2000,
      hourlyLimit: 1,
      leads: ["a@x.io", "b@x.io"],
    });
  });

  it("Send (no time chosen) posts the current time with an offset", async () => {
    const fetchMock = api();
    renderApp("/compose");
    await screen.findByLabelText("To");
    const before = Date.now();
    await fillValidForm();
    await userEvent.click(sendButton());
    await waitFor(() => expect(postedBodies(fetchMock)).toHaveLength(1));
    const { startTime } = postedBodies(fetchMock)[0]!;
    expect(startTime).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(new Date(startTime).getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(startTime).toBe(toIsoWithOffset(new Date(startTime)));
  });
});

describe("submitting", () => {
  it("success: toast with the server's counts, back to the dashboard, lists refetched", async () => {
    const fetchMock = api();
    renderApp("/compose");
    await screen.findByLabelText("To");
    await fillValidForm();
    await userEvent.click(sendButton());
    expect(
      await screen.findByText("Scheduled 3 emails · 1 duplicate · 1 invalid skipped."),
    ).toBeInTheDocument();
    expect(await screen.findByText("No scheduled emails")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/emails?status=scheduled")),
    ).toBe(true);
  });

  it("disables Send while submitting (no double submit)", async () => {
    let release!: () => void;
    const fetchMock = api(
      () =>
        new Promise<Response>((r) => {
          release = () => r(json(201, created));
        }) as unknown as Response,
    );
    renderApp("/compose");
    await screen.findByLabelText("To");
    await fillValidForm();
    await userEvent.click(sendButton());
    expect(sendButton()).toBeDisabled();
    await userEvent.click(sendButton());
    release();
    await screen.findByText(/Scheduled 3 emails/);
    expect(postedBodies(fetchMock)).toHaveLength(1);
  });

  it("maps a 400's details back onto the fields", async () => {
    api(() =>
      json(400, {
        error: "Validation failed",
        details: [{ field: "subject", message: "subject is too long" }],
      }),
    );
    renderApp("/compose");
    await screen.findByLabelText("To");
    await fillValidForm();
    await userEvent.click(sendButton());
    expect(await screen.findByText("Subject is too long")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a 400 without details (e.g. planning horizon) as a form error", async () => {
    api(() => json(400, { error: "Plan exceeds the 30-day planning horizon" }));
    renderApp("/compose");
    await screen.findByLabelText("To");
    await fillValidForm();
    await userEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("planning horizon");
  });

  it("503 partial enqueue: explains the emails are saved and blocks a duplicate resend", async () => {
    const fetchMock = api(() =>
      json(503, {
        error: "Campaign saved, but not every email could be queued right now.",
        campaignId: "c1",
        queued: 1,
        total: 2,
      }),
    );
    renderApp("/compose");
    await screen.findByLabelText("To");
    await fillValidForm();
    await userEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Campaign saved");
    expect(sendButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));
    expect(await screen.findByText("No scheduled emails")).toBeInTheDocument();
    expect(postedBodies(fetchMock)).toHaveLength(1);
  });
});

describe("leaving the page", () => {
  it("back with content asks for confirmation", async () => {
    api();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderApp("/compose");
    await userEvent.type(await screen.findByLabelText("Subject"), "Draft");
    await userEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Compose New Email" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(await screen.findByText("No scheduled emails")).toBeInTheDocument();
  });

  it("back on an empty form leaves without asking", async () => {
    api();
    const confirm = vi.spyOn(window, "confirm");
    renderApp("/compose");
    await userEvent.click(await screen.findByRole("button", { name: "Back to dashboard" }));
    expect(await screen.findByText("No scheduled emails")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
});
