import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "./loginErrors";

describe("loginErrorMessage", () => {
  it.each([
    ["access_denied", /cancelled/i],
    ["invalid_state", /expired/i],
    ["oauth_failed", /google sign-in failed/i],
    ["google_not_configured", /isn't set up/i],
  ])("maps %s to a readable message", (code, expected) => {
    expect(loginErrorMessage(code)).toMatch(expected);
  });

  it("falls back to a generic message for unknown codes, without echoing them", () => {
    const msg = loginErrorMessage("<script>alert(1)</script>");
    expect(msg).toMatch(/sign-in failed/i);
    expect(msg).not.toContain("script");
  });

  it("returns null when there is no error", () => {
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });
});
