const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");

/**
 * ISO 8601 in the browser's local time WITH its UTC offset, e.g.
 * "2026-11-26T10:00:00+05:30". The API requires an offset so a time is
 * never ambiguous, and keeping local wall time makes the payload readable.
 */
export function toIsoWithOffset(d: Date): string {
  const offsetMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = offsetMin >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

/** Value for <input type="datetime-local"> ("YYYY-MM-DDTHH:mm", local time). */
export function toLocalInputValue(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Parses a datetime-local value as local time; null if empty or invalid. */
export function fromLocalInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(y!, mo! - 1, d!, h!, mi!);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface TimePreset {
  label: string;
  at: Date;
}

/** Figma "Send Later" presets: Tomorrow (same time), and tomorrow at 10 AM, 11 AM and 3 PM. */
export function sendLaterPresets(now: Date): TimePreset[] {
  const tomorrowAt = (h: number, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d;
  };
  return [
    { label: "Tomorrow", at: tomorrowAt(now.getHours(), now.getMinutes()) },
    { label: "Tomorrow, 10:00 AM", at: tomorrowAt(10) },
    { label: "Tomorrow, 11:00 AM", at: tomorrowAt(11) },
    { label: "Tomorrow, 3:00 PM", at: tomorrowAt(15) },
  ];
}
