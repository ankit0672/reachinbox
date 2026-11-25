import { afterEach, describe, expect, it } from "vitest";
import { fromLocalInputValue, sendLaterPresets, toIsoWithOffset, toLocalInputValue } from "./time";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("toIsoWithOffset", () => {
  it("keeps local wall time and appends the offset (India, +05:30)", () => {
    process.env.TZ = "Asia/Kolkata";
    const iso = toIsoWithOffset(new Date("2026-11-26T04:30:00Z"));
    expect(iso).toBe("2026-11-26T10:00:00+05:30");
    expect(new Date(iso).toISOString()).toBe("2026-11-26T04:30:00.000Z"); // same instant
  });

  it("handles negative offsets (New York, -05:00)", () => {
    process.env.TZ = "America/New_York";
    expect(toIsoWithOffset(new Date("2026-11-26T15:00:00Z"))).toBe("2026-11-26T10:00:00-05:00");
  });

  it("uses +00:00 in UTC", () => {
    process.env.TZ = "UTC";
    expect(toIsoWithOffset(new Date("2026-11-26T10:00:00Z"))).toBe("2026-11-26T10:00:00+00:00");
  });
});

describe("datetime-local round trip", () => {
  it("formats and parses local time", () => {
    const d = new Date(2026, 10, 26, 9, 5);
    expect(toLocalInputValue(d)).toBe("2026-11-26T09:05");
    expect(fromLocalInputValue("2026-11-26T09:05")?.getTime()).toBe(d.getTime());
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("nope")).toBeNull();
  });
});

describe("sendLaterPresets", () => {
  it("offers tomorrow (same time), 10 AM, 11 AM and 3 PM", () => {
    const now = new Date(2026, 10, 25, 14, 37, 12);
    const presets = sendLaterPresets(now).map((p) => [p.label, toLocalInputValue(p.at)]);
    expect(presets).toEqual([
      ["Tomorrow", "2026-11-26T14:37"],
      ["Tomorrow, 10:00 AM", "2026-11-26T10:00"],
      ["Tomorrow, 11:00 AM", "2026-11-26T11:00"],
      ["Tomorrow, 3:00 PM", "2026-11-26T15:00"],
    ]);
  });
});
