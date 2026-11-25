import { describe, expect, it } from "vitest";
import { TunnelSetupError, ngrokArgs } from "../src/scripts/tunnel.js";

describe("npm run tunnel: ngrok arguments", () => {
  it("builds `ngrok http --url=<domain> <API_PORT>` from .env values", () => {
    expect(ngrokArgs({ NGROK_DOMAIN: "my-app.ngrok-free.dev", API_PORT: "3001" })).toEqual([
      "http",
      "--url=my-app.ngrok-free.dev",
      "3001",
    ]);
  });

  it("accepts a pasted https:// URL with a trailing slash", () => {
    expect(ngrokArgs({ NGROK_DOMAIN: " https://my-app.ngrok-free.dev/ " })[1]).toBe(
      "--url=my-app.ngrok-free.dev",
    );
  });

  it("defaults the port to 3001", () => {
    expect(ngrokArgs({ NGROK_DOMAIN: "x.ngrok-free.dev" })[2]).toBe("3001");
  });

  it("fails with a clear message when NGROK_DOMAIN is missing or empty", () => {
    for (const NGROK_DOMAIN of [undefined, "", "   "]) {
      expect(() => ngrokArgs({ NGROK_DOMAIN })).toThrow(TunnelSetupError);
      expect(() => ngrokArgs({ NGROK_DOMAIN })).toThrow(/NGROK_DOMAIN is not set/);
    }
  });

  it("rejects a non-numeric port", () => {
    expect(() => ngrokArgs({ NGROK_DOMAIN: "x.ngrok-free.dev", API_PORT: "abc" })).toThrow(
      /API_PORT/,
    );
  });
});
