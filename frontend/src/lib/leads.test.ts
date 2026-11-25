import { describe, expect, it } from "vitest";
import { extractAddresses, formatLeadSummary, splitTokens, summarizeLeads } from "./leads";

describe("extractAddresses (CSV/TXT upload)", () => {
  it("finds addresses in any column and ignores headers and names", () => {
    const csv = [
      "name,company,email,backup",
      "Tame,Acme,tame@jmail.com,",
      '"Lame, Jr.",Beta,LAME@jmail.com,"dame@jmail.com"',
      "No Email,Gamma,,",
    ].join("\n");
    expect(extractAddresses(csv)).toEqual(["tame@jmail.com", "LAME@jmail.com", "dame@jmail.com"]);
  });

  it("keeps @-tokens that are not valid so they count as invalid", () => {
    expect(extractAddresses("email\nbad@\n@nope.com\nok@x.io")).toEqual([
      "bad@",
      "@nope.com",
      "ok@x.io",
    ]);
  });

  it("reads TXT lists separated by newlines, commas, semicolons or spaces", () => {
    const txt = "a@x.io\r\nb@x.io, c@x.io; d@x.io e@x.io\n\n<f@x.io>";
    expect(extractAddresses(txt)).toEqual([
      "a@x.io",
      "b@x.io",
      "c@x.io",
      "d@x.io",
      "e@x.io",
      "f@x.io",
    ]);
  });
});

describe("summarizeLeads (same rules as the server)", () => {
  it("counts duplicates case-insensitively and invalid entries, keeping first-seen order", () => {
    const s = summarizeLeads(["B@x.io", "a@x.io", "b@x.io ", "bad@", "A@X.IO", "@x.io"]);
    expect(s.valid).toEqual(["b@x.io", "a@x.io"]);
    expect(s.duplicates).toBe(2);
    expect(s.invalid).toEqual(["bad@", "@x.io"]);
    expect(s.total).toBe(6);
    expect(formatLeadSummary(s)).toBe("2 valid · 2 duplicates · 2 invalid");
  });

  it("uses the singular for one duplicate", () => {
    expect(formatLeadSummary(summarizeLeads(["a@x.io", "a@x.io"]))).toBe(
      "1 valid · 1 duplicate · 0 invalid",
    );
  });

  it("rejects what zod's z.email() rejects", () => {
    const s = summarizeLeads([
      "a..b@x.io",
      "a@x",
      "a@-x.io",
      "a b@x.io",
      "first.last+tag@sub.x.io",
    ]);
    expect(s.valid).toEqual(["first.last+tag@sub.x.io"]);
  });
});

describe("splitTokens (typed or pasted text)", () => {
  it("splits on commas, semicolons and whitespace and strips wrappers", () => {
    expect(splitTokens(' "a@x.io", <b@x.io>;c@x.io\n')).toEqual(["a@x.io", "b@x.io", "c@x.io"]);
  });
});
