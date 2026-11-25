import Papa from "papaparse";

/**
 * zod 4's z.email() pattern, the same check the API runs (normalizeLeads in
 * backend/src/services/scheduleService.ts), so client counts match the server's.
 */
const EMAIL_RE =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export const normalizeEmail = (s: string) => s.trim().toLowerCase();
export const isValidEmail = (s: string) => EMAIL_RE.test(normalizeEmail(s));

/** Characters that commonly wrap an address in exports: <a@b.com>, "a@b.com", (a@b.com). */
const WRAPPERS = /^[<"'([]+|[>"')\],.;:]+$/g;

/** Split free text (a typed or pasted line, one CSV cell) into address-like tokens. */
export function splitTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.replace(WRAPPERS, ""))
    .filter(Boolean);
}

/**
 * Every token containing "@" in any column of a CSV/TXT file. Tokens
 * without "@" (headers, names, company columns) are ignored; tokens with "@"
 * that fail validation are kept, so they count as invalid.
 */
export function extractAddresses(fileText: string): string[] {
  const parsed = Papa.parse<string[]>(fileText, { skipEmptyLines: true });
  const out: string[] = [];
  for (const row of parsed.data) {
    for (const cell of row) {
      for (const token of splitTokens(String(cell))) {
        if (token.includes("@")) out.push(token);
      }
    }
  }
  return out;
}

export interface LeadSummary {
  /** Unique valid addresses, normalized, in first-seen order. */
  valid: string[];
  duplicates: number;
  /** Entries that failed validation, as given. */
  invalid: string[];
  /** Everything that will be sent to the API (the limit applies to this). */
  total: number;
}

/** Same rules as the server: trim + lowercase, first of any duplicate wins. */
export function summarizeLeads(entries: string[]): LeadSummary {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const entry of entries) {
    const email = normalizeEmail(entry);
    if (!EMAIL_RE.test(email)) invalid.push(entry);
    else if (seen.has(email)) duplicates += 1;
    else {
      seen.add(email);
      valid.push(email);
    }
  }
  return { valid, duplicates, invalid, total: entries.length };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 valid · 1 duplicate · 2 invalid" */
export function formatLeadSummary(s: LeadSummary): string {
  return `${s.valid.length} valid · ${plural(s.duplicates, "duplicate")} · ${s.invalid.length} invalid`;
}

export { plural };
