/**
 * Zoer's calendar-relative timestamps (frontend/src/lib/formatTime.ts), which the host does not
 * export to native workspaces: "Today 6:58 PM", "Yesterday 2:00 AM", "Mon 6:58 PM", "Oct 3, 6:58 PM"
 * (year only outside the current year). Use instead of `toLocaleString()`.
 */
type TimeInput = string | number | Date;
const DAY_MS = 86_400_000;
const toDate = (value: TimeInput) => { const date = value instanceof Date ? new Date(value.getTime()) : new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const dayOffset = (date: Date, now: Date) => Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);

export function formatDayLabel(value: TimeInput, now: Date = new Date(), locale?: string): string {
  const date = toDate(value);
  if (!date) return "";
  const offset = dayOffset(date, now);
  if (offset === 0) return "Today";
  if (offset === -1) return "Yesterday";
  if (offset === 1) return "Tomorrow";
  if (Math.abs(offset) < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(date);
}

/** "Today 6:58 PM", "Mon 6:58 PM", "Oct 3, 6:58 PM". Returns the input unchanged when it can't be parsed. */
export function formatWhen(value: TimeInput, now: Date = new Date(), locale?: string): string {
  const date = toDate(value);
  if (!date) return typeof value === "string" ? value : "";
  const day = formatDayLabel(date, now, locale);
  return `${day}${/\d/.test(day) ? ", " : " "}${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date)}`;
}
