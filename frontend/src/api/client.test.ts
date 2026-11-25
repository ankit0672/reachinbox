import { describe, expect, it } from "vitest";
import { json, mockApi } from "../test/helpers";
import { ApiError, apiFetch, UnauthorizedError } from "./client";

describe("apiFetch", () => {
  it("calls the relative /api path with credentials and parses JSON", async () => {
    const fetchMock = mockApi({ "GET /api/thing": () => json(200, { ok: 1 }) });
    await expect(apiFetch("/api/thing")).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/thing");
    expect(init?.credentials).toBe("include");
  });

  it("throws UnauthorizedError on 401", async () => {
    mockApi({ "GET /api/thing": () => json(401, { error: "Not authenticated" }) });
    await expect(apiFetch("/api/thing")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ApiError with the server's message on other failures", async () => {
    mockApi({ "GET /api/thing": () => json(503, { error: "Database down" }) });
    const err = await apiFetch("/api/thing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toBe("Database down");
  });

  it("returns undefined for 204 No Content", async () => {
    mockApi({ "POST /api/thing": () => new Response(null, { status: 204 }) });
    await expect(apiFetch("/api/thing", { method: "POST" })).resolves.toBeUndefined();
  });
});
