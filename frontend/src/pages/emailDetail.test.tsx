import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { EmailDetail } from "../api/types";
import { dashboardRoutes, emailItem, json, mockApi, renderApp } from "../test/helpers";

const detail = (over: Partial<EmailDetail> = {}): EmailDetail => ({
  id: "e-1",
  toEmail: "john@example.com",
  subject: "Meeting follow-up",
  body: "Hey John,\n\nJust following up.\n\nGrant",
  status: "sent",
  scheduledAt: "2026-11-24T09:15:00Z",
  sentAt: "2026-11-24T09:15:03Z",
  failedAt: null,
  previewUrl: "https://ethereal.email/message/abc",
  errorMessage: null,
  ...over,
});

function setup(email: EmailDetail | null) {
  return mockApi({
    ...dashboardRoutes({ sent: [emailItem({ id: "e-1", status: "sent", subject: "Row" })] }),
    "GET /api/emails/e-1": () =>
      email ? json(200, email) : json(404, { error: "Email not found" }),
  });
}

describe("email detail page", () => {
  it("shows recipient, subject, status, times, the body and the Ethereal link", async () => {
    setup(detail());
    renderApp("/emails/e-1");
    expect(await screen.findByRole("heading", { name: "Meeting follow-up" })).toBeInTheDocument();
    expect(screen.getByText("To: john@example.com")).toBeInTheDocument();
    expect(screen.getByText("Tue, Nov 24, 2026, 9:15:00 AM UTC")).toBeInTheDocument();
    expect(screen.getByText("Tue, Nov 24, 2026, 9:15:03 AM UTC")).toBeInTheDocument();
    expect(screen.getByText(/^Sent /)).toHaveClass("bg-chip-neutral");
    expect(screen.getByText(/Just following up/)).toHaveClass("whitespace-pre-wrap");
    const preview = screen.getByRole("link", { name: /ethereal preview/i });
    expect(preview).toHaveAttribute("href", "https://ethereal.email/message/abc");
    expect(preview).toHaveAttribute("target", "_blank");
    expect(preview).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the failure reason and time for a failed email, without a preview link", async () => {
    setup(
      detail({
        status: "failed",
        sentAt: null,
        failedAt: "2026-11-24T09:16:00Z",
        previewUrl: null,
        errorMessage: "SMTP 421 service not available",
      }),
    );
    renderApp("/emails/e-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sending failed after all retries. SMTP 421 service not available",
    );
    expect(screen.getByText("Tue, Nov 24, 2026, 9:16:00 AM UTC")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ethereal preview/i })).toBeNull();
  });

  it("404 (missing or someone else's): 'Email not found' with a way back", async () => {
    setup(null);
    renderApp("/emails/e-1");
    expect(await screen.findByText("Email not found")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Back to dashboard" }));
    expect(await screen.findByRole("navigation", { name: "Mailboxes" })).toBeInTheDocument();
  });

  it("a list row opens the email, and Back returns to the same tab", async () => {
    setup(detail());
    renderApp("/dashboard/sent");
    const list = await screen.findByRole("region", { name: "Sent emails" });
    await userEvent.click(within(list).getByRole("link", { name: /Row/ }));
    expect(await screen.findByRole("heading", { name: "Meeting follow-up" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("region", { name: "Sent emails" })).toBeInTheDocument();
  });
});
