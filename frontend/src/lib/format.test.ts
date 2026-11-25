import { describe, expect, it } from "vitest";
import { formatChipTime, formatFullTime, previewText } from "./format";

// Tests run with TZ=UTC (vite.config.ts).
const NOW = new Date("2026-11-25T12:00:00Z"); // a Wednesday

describe("formatChipTime", () => {
  it("uses the Figma weekday shape within six days", () => {
    expect(formatChipTime("2026-11-24T09:15:12Z", NOW)).toBe("Tue 9:15:12 AM");
    expect(formatChipTime("2026-11-26T20:15:12Z", NOW)).toBe("Thu 8:15:12 PM");
  });

  it("shows the date when the weekday would be ambiguous", () => {
    expect(formatChipTime("2026-11-03T10:23:00Z", NOW)).toBe("Nov 3, 10:23:00 AM");
    expect(formatChipTime("2025-12-31T23:00:00Z", NOW)).toBe("Dec 31, 2025, 11:00 PM");
  });
});

describe("formatFullTime", () => {
  it("includes the date and the zone", () => {
    expect(formatFullTime("2026-11-24T09:15:12Z")).toBe("Tue, Nov 24, 2026, 9:15:12 AM UTC");
  });
});

describe("previewText", () => {
  it("collapses whitespace and cuts long text with an ellipsis", () => {
    expect(previewText("  Hi\n\n there\t you ")).toBe("Hi there you");
    const cut = previewText("word ".repeat(50), 20);
    expect(cut).toBe("word word word word…");
  });
});
