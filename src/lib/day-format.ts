import { addDays, isoWeek } from "./workout-doc";

// How calendar days and weeks are written across the site. Days are Stockholm
// calendar days as YYYY-MM-DD; formatting them in UTC keeps the date unchanged.

const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function read(day: string) {
  const found = Object.fromEntries(parts.formatToParts(new Date(`${day}T00:00:00Z`)).map(({ type, value }) => [type, value]));
  // Three-letter months throughout: en-GB alone shortens September to "Sept".
  return { weekday: found.weekday, day: found.day, month: found.month.slice(0, 3), year: found.year };
}

/** Mon 16 */
export function dayShort(day: string): string {
  const date = read(day);
  return `${date.weekday} ${date.day}`;
}

/** Mon 16 Nov */
export function dayLabel(day: string): string {
  const date = read(day);
  return `${date.weekday} ${date.day} ${date.month}`;
}

/** Mon 16 Nov 2026 */
export function dayLong(day: string): string {
  const date = read(day);
  return `${date.weekday} ${date.day} ${date.month} ${date.year}`;
}

/** 16 Nov, or 16 Nov 2025 when the year differs from the one given. */
export function dateLabel(day: string, currentYear?: string): string {
  const date = read(day);
  return currentYear && date.year !== currentYear ? `${date.day} ${date.month} ${date.year}` : `${date.day} ${date.month}`;
}

/** The span of the week starting on this Monday: 16–22 Nov, 26 Oct–1 Nov, 28 Dec 2026–3 Jan 2027. */
export function weekRange(monday: string): string {
  const first = read(monday);
  const last = read(addDays(monday, 6));
  if (first.year !== last.year) return `${first.day} ${first.month} ${first.year}–${last.day} ${last.month} ${last.year}`;
  if (first.month !== last.month) return `${first.day} ${first.month}–${last.day} ${last.month}`;
  return `${first.day}–${last.day} ${last.month}`;
}

/** Weeks are named the Swedish way: v. 47. Pair it with weekName for screen readers. */
export function weekLabel(day: string): string {
  return `v. ${isoWeek(day).week}`;
}

/** Week 47 */
export function weekName(day: string): string {
  return `Week ${isoWeek(day).week}`;
}

/** An anchor id for a week on the training page: w-2026-47. */
export function weekAnchor(day: string): string {
  const { year, week } = isoWeek(day);
  return `w-${year}-${String(week).padStart(2, "0")}`;
}

/** 14:05, the Stockholm clock time of an instant. */
export function clockTime(instant: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Stockholm" })
    .format(typeof instant === "string" ? new Date(instant) : instant);
}
