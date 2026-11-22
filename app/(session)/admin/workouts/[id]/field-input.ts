import { formatDurationInput, parseDurationInput } from "@/src/lib/duration-input";
import { formatNumber, limits, repTarget } from "@/src/lib/workout-doc";

// Turning what was typed into a set field into a number, and saying when it cannot be one.

type Range = { integer?: boolean; min?: number; max: number };

/** A number with a point or a decimal comma. "" is null; anything unreadable or out of range is "invalid". */
export function parseNumberInput(text: string, { integer = false, min = 0, max }: Range): number | null | "invalid" {
  const value = text.trim().replace(/^\+/, "").replace(",", ".");
  if (value === "") return null;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(value)) return "invalid";
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return "invalid";
  if (integer && !Number.isInteger(number)) return "invalid";
  return number;
}

export type RepsTarget = { reps: number | null; repsMax: number | null };

/** "5", or a range written 8-12 or 8–12. A range that does not rise is invalid. */
export function parseRepsTarget(text: string, max = 10000): RepsTarget | "invalid" {
  const value = text.trim();
  if (value === "") return { reps: null, repsMax: null };
  const range = /^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/.exec(value);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (high > max || low > max || high < low) return "invalid";
    return { reps: low, repsMax: high > low ? high : null };
  }
  const single = parseNumberInput(value, { integer: true, max });
  if (single === "invalid" || /[.,+]/.test(value)) return "invalid";
  return { reps: single, repsMax: null };
}

export type Codec<T> = { parse(text: string): T | "invalid"; format(value: T): string };

export const decimalCodec = (max: number, min = 0): Codec<number | null> => ({
  parse: (text) => parseNumberInput(text, { max, min }),
  format: (value) => (value === null ? "" : formatNumber(value)),
});

export const integerCodec = (max: number): Codec<number | null> => ({
  parse: (text) => parseNumberInput(text, { max, integer: true }),
  format: (value) => (value === null ? "" : formatNumber(value)),
});

export const durationCodec: Codec<number | null> = {
  parse: parseDurationInput,
  format: (value) => (value === null ? "" : formatDurationInput(value)),
};

/** Distance is stored in metres and typed in kilometres. */
export const kilometreCodec: Codec<number | null> = {
  parse: (text) => {
    const km = parseNumberInput(text, { max: limits.distanceMeters / 1000 });
    return km === null || km === "invalid" ? km : Math.round(km * 1000);
  },
  format: (value) => (value === null ? "" : formatNumber(value / 1000)),
};

export const repsTargetCodec: Codec<RepsTarget> = {
  parse: (text) => parseRepsTarget(text, limits.reps),
  format: (value) => repTarget(value),
};

export const loadCodec = decimalCodec(limits.loadKg);
export const repsCodec = integerCodec(limits.reps);
export const rpeCodec = decimalCodec(10, 1);
