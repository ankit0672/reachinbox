import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, ME, mockApi, renderApp } from "../test/helpers";

describe("auth guard", () => {
  it("sends the user to /login when /api/auth/me returns 401", async () => {
    mockApi({ "GET /api/auth/me": () => json(401, { error: "Not authenticated" }) });
    renderApp("/dashboard");
    expect(await screen.findByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByText(ME.name)).not.toBeInTheDocument();
  });

  it("shows a retryable error (not the login page) when the API is unreachable", async () => {
    let up = false;
    mockApi({
      "GET /api/auth/me": () => (up ? json(200, ME) : json(502, { error: "Bad gateway" })),
    });
    renderApp("/dashboard");
    expect(await screen.findByText(/can't reach the server/i)).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(ME.name)).toBeInTheDocument();
  });

  it("renders the dashboard shell for a signed-in user", async () => {
    mockApi({ "GET /api/auth/me": () => json(200, ME) });
    renderApp("/dashboard");
    expect(await screen.findByText(ME.name)).toBeInTheDocument();
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /scheduled/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(within(nav).getByRole("link", { name: /sent/i }));
    expect(within(nav).getByRole("link", { name: /sent/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: /compose/i })).toBeInTheDocument();
  });
});

describe("header (sidebar user card)", () => {
  it("shows the user's name, email and avatar", async () => {
    mockApi({ "GET /api/auth/me": () => json(200, ME) });
    renderApp("/dashboard");
    expect(await screen.findByText(ME.name)).toBeInTheDocument();
    expect(screen.getByText(ME.email)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: ME.name })).toHaveAttribute("src", ME.avatarUrl);
  });

  it("falls back to the initial when the avatar fails to load", async () => {
    mockApi({ "GET /api/auth/me": () => json(200, ME) });
    renderApp("/dashboard");
    fireEvent.error(await screen.findByRole("img", { name: ME.name }));
    const fallback = screen.getByRole("img", { name: ME.name });
    expect(fallback.tagName).not.toBe("IMG");
    expect(fallback).toHaveTextContent("O");
  });

  it("uses the initial when there is no avatar URL at all", async () => {
    mockApi({ "GET /api/auth/me": () => json(200, { ...ME, avatarUrl: null }) });
    renderApp("/dashboard");
    expect(await screen.findByRole("img", { name: ME.name })).toHaveTextContent("O");
  });

  it("logout calls POST /api/auth/logout and returns to the login page", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": () => json(200, ME),
      "POST /api/auth/logout": () => new Response(null, { status: 204 }),
    });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: /account menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /log out/i }));

    expect(await screen.findByRole("heading", { name: "Login" })).toBeInTheDocument();
    const logoutCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/auth/logout" && init?.method === "POST",
    );
    expect(logoutCall).toBeDefined();
  });

  it("a failed logout shows an error toast and keeps the user signed in", async () => {
    mockApi({
      "GET /api/auth/me": () => json(200, ME),
      "POST /api/auth/logout": () => json(500, { error: "Internal server error" }),
    });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: /account menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /log out/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't log out/i);
    await waitFor(() => expect(screen.getByText(ME.name)).toBeInTheDocument());
  });
});

describe("login page", () => {
  it("shows the ?error= code as a readable message", async () => {
    mockApi({});
    renderApp("/login?error=access_denied");
    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled/i);
  });

  it("only Google login works: the link goes to /api/auth/google, email login is disabled", () => {
    mockApi({});
    renderApp("/login");
    expect(screen.getByRole("link", { name: /login with google/i })).toHaveAttribute(
      "href",
      "/api/auth/google",
    );
    expect(screen.getByPlaceholderText("Email ID")).toBeDisabled();
    expect(screen.getByPlaceholderText("Password")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Login" })).toBeDisabled();
    expect(screen.getByText(/email login isn't available yet, please use google/i)).toBeVisible();
  });
});
