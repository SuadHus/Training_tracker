// How long a session took: what the owner may type when finishing it, and the time measured from the sets.
// Pure, so the Finish sheet, the server and the tests share it.
import { limits } from "./workout-doc";

/**
 * Minutes for what was typed: "100" or "1:40" (hours and minutes). null for an empty field,
 * "invalid" for anything else, including zero and more than a day. Nothing is guessed at:
 * "1:5" could be 1:05 or 1:50, so the minutes of hours and minutes take two digits.
 */
export function parseSessionTime(text: string): number | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  const plain = /^(\d{1,4})$/.exec(value);
  const clock = /^(\d{1,2})\s*:\s*(\d{2})$/.exec(value);
  let minutes: number;
  if (plain) minutes = Number(plain[1]);
  else if (clock && Number(clock[2]) < 60) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else return "invalid";
  return minutes >= 1 && minutes <= limits.sessionMinutes ? minutes : "invalid";
}

/** Whether a value is a session time: whole minutes, 1 to a day. The action and the store both ask, since what reaches them is whatever the client sent. */
export function isSessionMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= limits.sessionMinutes;
}

/** What Finish does with the field: send the minutes (null for the measured time), or stop because the entry cannot be read. */
export function finishTime(text: string): { stop: false; minutes: number | null } | { stop: true } {
  const minutes = parseSessionTime(text);
  return minutes === "invalid" ? { stop: true } : { stop: false, minutes };
}

/** What goes back into the field: 45, 1:40. It reads back as the same minutes. */
export function formatSessionTime(minutes: number): string {
  return minutes < 60 ? String(minutes) : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Whole minutes between the first and last logged set; anything outside 5 to 360 is a forgotten timer, not a session. */
export function measuredMinutes(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const minutes = (end.valueOf() - start.valueOf()) / 60_000;
  return minutes >= 5 && minutes <= 360 ? Math.round(minutes) : null;
}

/** The time to show beside a session: the one the owner typed, as typed, else the measured one. */
export function shownMinutes(typed: number | null, start: Date | null, end: Date | null): number | null {
  return typed ?? measuredMinutes(start, end);
}
