// A time typed into one text field: 90, 1:30 or 1:02:30. Pure, so the logger and tests share it.

const MAX_SECONDS = 86400;

/** Seconds for what was typed, null for an empty field, "invalid" for anything else. */
export function parseDurationInput(text: string): number | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  if (!/^\d{1,6}(:\d{1,2}){0,2}$/.test(value)) return "invalid";
  const parts = value.split(":").map(Number);
  let seconds: number;
  if (parts.length === 1) {
    seconds = parts[0];
  } else {
    if (parts.slice(1).some((part) => part > 59)) return "invalid";
    seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return seconds > MAX_SECONDS ? "invalid" : seconds;
}

/** 0:45, 1:30, 1:02:30. Always has a colon, so a typed 45 and a shown 0:45 are told apart. */
export function formatDurationInput(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
