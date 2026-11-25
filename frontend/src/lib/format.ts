/**
 * Shared date/text formatters. Times are shown in the browser's time zone
 * with a fixed en-US shape so they match the Figma ("Tue 9:15:12 AM").
 */

const LOCALE = "en-US";
const DAY_MS = 86_400_000;

const weekdayTime = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const dateTime = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const dateTimeWithYear = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const full = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

/** Remove the comma Intl puts between weekday and time ("Tue, 9:15" -> "Tue 9:15"). */
const tidy = (s: string) => s.replace(/^(\w{3}),/, "$1");

/**
 * Compact chip time. Within six days of now: "Tue 9:15:12 AM" (Figma).
 * Further away the weekday would be ambiguous, so the date is shown instead.
 */
export function formatChipTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Math.abs(d.getTime() - now.getTime()) < 6 * DAY_MS) return tidy(weekdayTime.format(d));
  if (d.getFullYear() === now.getFullYear()) return dateTime.format(d);
  return dateTimeWithYear.format(d);
}

/** Unambiguous full timestamp with zone, for tooltips and the detail page. */
export function formatFullTime(iso: string): string {
  return full.format(new Date(iso));
}

/** Collapse whitespace and cut to `max` characters with an ellipsis. */
export function previewText(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed;
}
