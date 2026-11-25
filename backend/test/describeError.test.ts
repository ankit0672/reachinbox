import { errors } from "@elastic/elasticsearch";
import { describe, expect, it, vi } from "vitest";
import { describeError } from "../src/lib/describeError.js";
import { bestEffort } from "../src/search/emailIndex.js";
import { deadIndex } from "./helpers/testIndex.js";

describe("describeError", () => {
  it("uses the message when there is one", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("falls back to name/code when the message is empty (ES ConnectionError, ioredis AggregateError)", () => {
    const err = Object.assign(new Error(""), { name: "ConnectionError", code: "ECONNREFUSED" });
    expect(describeError(err)).toBe("ConnectionError (ECONNREFUSED)");
    expect(describeError(new errors.ConnectionError(""))).toMatch(/ConnectionError/);
  });

  it("bestEffort logs a non-empty reason for a real unreachable cluster", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await bestEffort("probe", () => deadIndex().ensureIndex());
    expect(log.mock.calls[0]![0]).toMatch(/probe failed .*: \S+/);
    log.mockRestore();
  });
});
