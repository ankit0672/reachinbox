import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SlackStatus } from "../../api/slack";
import { slackOutcome } from "../../slack/slack";
import { dashboardRoutes, json, mockApi, renderApp } from "../../test/helpers";

function setup(status: () => SlackStatus | Response) {
  return mockApi({
    ...dashboardRoutes(),
    "GET /api/slack/status": () => {
      const s = status();
      return s instanceof Response ? s : json(200, s);
    },
    "DELETE /api/slack/disconnect": () => new Response(null, { status: 204 }),
  });
}

async function openMenu() {
  await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
  return screen.getByRole("menu", { name: "Account" });
}

describe("Slack in the user menu", () => {
  it("not connected: 'Connect Slack' is a full-page link to /api/slack/connect", async () => {
    setup(() => ({ available: true, connected: false }));
    renderApp("/dashboard");
    const menu = await openMenu();
    const connect = await within(menu).findByRole("menuitem", { name: "Connect Slack" });
    expect(connect.tagName).toBe("A");
    expect(connect).toHaveAttribute("href", "/api/slack/connect");
  });

  it("connected: shows the workspace and Disconnect calls the API and refetches", async () => {
    let connected = true;
    const fetchMock = setup(() =>
      connected
        ? { available: true, connected: true, teamName: "reachinbox-dev" }
        : { available: true, connected: false },
    );
    renderApp("/dashboard");
    const menu = await openMenu();
    expect(await within(menu).findByText(/Slack connected/)).toHaveTextContent(
      "Slack connected ✓ (reachinbox-dev)",
    );
    expect(within(menu).queryByRole("menuitem", { name: "Connect Slack" })).toBeNull();

    connected = false;
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Disconnect Slack" }));
    expect(await screen.findByText("Slack disconnected. Rate-limit alerts are off.")).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/api/slack/disconnect" && init?.method === "DELETE",
      ),
    ).toBe(true);
    expect(await within(menu).findByRole("menuitem", { name: "Connect Slack" })).toBeVisible();
  });

  it("not configured on the server: the item is disabled with a clear label", async () => {
    setup(() => ({ available: false, connected: false }));
    renderApp("/dashboard");
    const menu = await openMenu();
    expect(
      await within(menu).findByRole("menuitem", { name: /slack isn't set up on this server/i }),
    ).toBeDisabled();
  });

  it("status error: offers a retry instead of a broken item", async () => {
    let fail = true;
    setup(() => (fail ? json(500, { error: "boom" }) : { available: true, connected: false }));
    renderApp("/dashboard");
    const menu = await openMenu();
    const retry = await within(menu).findByRole(
      "menuitem",
      { name: /slack status unavailable/i },
      { timeout: 3000 },
    );
    fail = false;
    await userEvent.click(retry);
    expect(await within(menu).findByRole("menuitem", { name: "Connect Slack" })).toBeVisible();
  });
});

describe("?slack= outcome after the OAuth round trip", () => {
  it("connected: one success toast, parameter removed, menu shows the fresh status", async () => {
    setup(() => ({ available: true, connected: true, teamName: "reachinbox-dev" }));
    renderApp("/dashboard?slack=connected");
    expect(
      await screen.findByText("Slack connected. Rate-limit alerts will arrive as a DM."),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/dashboard$/));
    expect(screen.getAllByText(/Slack connected\. Rate-limit/)).toHaveLength(1);
    const menu = await openMenu();
    expect(await within(menu).findByText(/reachinbox-dev/)).toBeVisible();
  });

  it("error: error toast", async () => {
    setup(() => ({ available: true, connected: false }));
    renderApp("/dashboard?slack=error");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't connect Slack. Please try again.",
    );
  });

  it.each([
    ["denied", "Slack connection was cancelled."],
    ["invalid_state", "That Slack link expired or was already used. Try Connect Slack again."],
    ["not_configured", "Slack isn't set up on this server."],
    ["<b>x</b>", "Slack connection didn't complete. Please try again."],
  ])("maps %s to a readable message", (code, message) => {
    expect(slackOutcome(code).message).toBe(message);
  });
});
