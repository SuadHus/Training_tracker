type SetForSummary = {
  reps: number | null;
  loadKg: number | null;
  warmup: boolean;
  rpe: number | null;
  primaryMuscle: string;
};

export function summarizeWorkout(sets: SetForSummary[]) {
  const work = sets.filter((set) => !set.warmup);
  const ratings = work.flatMap((set) => set.rpe === null ? [] : [set.rpe]);
  const muscles = new Map<string, number>();
  for (const set of work) {
    muscles.set(set.primaryMuscle, (muscles.get(set.primaryMuscle) ?? 0) + 1);
  }
  return {
    workSets: work.length,
    tonnage: work.reduce((total, set) => total + (set.reps ?? 0) * (set.loadKg ?? 0), 0),
    averageRpe: ratings.length ? ratings.reduce((total, rpe) => total + rpe, 0) / ratings.length : null,
    muscles: Object.fromEntries(muscles),
  };
}

export function valueForField(values: Record<string, unknown>, id: string, unit: string) {
  const value = values[id];
  if (typeof value !== "number" && typeof value !== "string") return null;
  return unit ? `${value} ${unit}` : String(value);
}

export function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")) return false;
  const date = new Date(day);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

export function stockholmDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"].map((part) => parts.find(({ type }) => type === part)?.value).join("-");
}

export function displayDay(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(day));
}

export function validId(id: string) {
  return /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
}

export const numberLabel = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
