// The shape of a workout as the editor, the server and the public pages share it.
// A workout is an ordered list of exercise blocks; each block owns its sets.
// Templates, planned sessions and completed sessions all use this one shape.
// Everything here is pure, so it runs on the server, in the browser and in tests.

export const TRACKINGS = ["weight_reps", "bodyweight_reps", "duration", "distance_duration"] as const;
export type Tracking = (typeof TRACKINGS)[number];

export const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "kettlebell", "bodyweight", "other"] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export type WorkoutStatus = "template" | "planned" | "completed";
export type FieldKind = "decimal" | "integer" | "text";
export type CustomValues = Record<string, string | number>;

export const trackingLabels: Record<Tracking, string> = {
  weight_reps: "Weight and reps",
  bodyweight_reps: "Bodyweight reps",
  duration: "Time",
  distance_duration: "Distance and time",
};

export const equipmentLabels: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  machine: "Machine",
  cable: "Cable",
  kettlebell: "Kettlebell",
  bodyweight: "Bodyweight",
  other: "Other",
};

/** Offered when naming an exercise's muscles; any other text is accepted too. */
export const USUAL_MUSCLES = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms", "Core", "Glutes", "Quads", "Hamstrings", "Calves", "Legs", "Full body",
] as const;

export type ExerciseInfo = {
  id: string;
  name: string;
  tracking: Tracking;
  equipment: Equipment;
  /** Weight of the empty bar. Only meaningful for barbell exercises; null means the standard 20 kg bar. */
  barKg: number | null;
  /** Default rest after a set of this exercise, in seconds. */
  restSeconds: number | null;
  primaryMuscle: string;
  secondaryMuscles: string[];
  notes: string;
  archived: boolean;
};

/** "Barbell, Quads". Equipment that says nothing ("Other") is left out. */
export function exerciseMeta(exercise: Pick<ExerciseInfo, "equipment" | "primaryMuscle">): string {
  return [exercise.equipment === "other" ? "" : equipmentLabels[exercise.equipment], exercise.primaryMuscle].filter(Boolean).join(", ");
}

/**
 * Whether an exercise answers a search. Every typed word must sit inside the name or
 * start a word of its muscles or equipment, so "chin" finds Chin-up and not "Machine".
 */
export function exerciseMatches(
  exercise: Pick<ExerciseInfo, "name" | "equipment" | "primaryMuscle" | "secondaryMuscles">, search: string,
): boolean {
  const name = exercise.name.toLowerCase();
  const starts = [exercise.primaryMuscle, ...exercise.secondaryMuscles, equipmentLabels[exercise.equipment]]
    .flatMap((text) => text.toLowerCase().split(/[\s-]+/));
  return search.toLowerCase().split(/\s+/).filter(Boolean)
    .every((word) => name.includes(word) || starts.some((start) => start.startsWith(word)));
}

export type FieldInfo = { id: string; label: string; unit: string; kind: FieldKind; exerciseId: string | null };

/** What one set measures. Load is kilograms, duration seconds, distance metres. */
export type Measures = {
  reps: number | null;
  load: number | null;
  rpe: number | null;
  duration: number | null;
  distance: number | null;
};

/** A target may give a rep range: reps is the lower bound, repsMax the upper. */
export type SetTarget = Measures & { repsMax: number | null };

export type SetDoc = {
  id: string;
  warmup: boolean;
  target: SetTarget;
  actual: Measures;
  custom: CustomValues;
  /** ISO timestamp of when the set was done. null means not done; values typed into an undone set are a draft. */
  loggedAt: string | null;
};

export type BlockDoc = {
  id: string;
  exerciseId: string;
  notes: string;
  /** Rest after each set of this block, in seconds. null falls back to the exercise, then to DEFAULT_REST_SECONDS. */
  restSeconds: number | null;
  sets: SetDoc[];
};

export type WorkoutDoc = {
  id: string;
  status: WorkoutStatus;
  title: string;
  /** Stockholm calendar day, YYYY-MM-DD. Always null for templates, never null otherwise. */
  day: string | null;
  notes: string;
  templateId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * How long the session took, in minutes, as the owner typed it when finishing; null means the
   * measured time is used. Not part of the draft: only finishing a session sets or clears it.
   */
  durationMinutes: number | null;
  /** Bumped by every save. A save names the revision it started from. */
  revision: number;
  blocks: BlockDoc[];
};

/** The part of a workout the editor may change through a save. */
export type WorkoutDraft = Pick<WorkoutDoc, "title" | "day" | "notes" | "blocks">;

export const DEFAULT_REST_SECONDS = 150;
export const STANDARD_BAR_KG = 20;
/** Calibrated plates, heaviest first, as pairs are available in most gyms. */
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export const limits = {
  title: 120,
  notes: 4000,
  blockNotes: 500,
  blocks: 40,
  setsPerBlock: 30,
  reps: 10000,
  loadKg: 100000,
  durationSeconds: 86400,
  distanceMeters: 1_000_000,
  restSeconds: 3600,
  /** The longest session time that can be typed: a day. */
  sessionMinutes: 1440,
  customText: 500,
} as const;

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export const noMeasures: Measures = { reps: null, load: null, rpe: null, duration: null, distance: null };

export function emptySet(overrides: Partial<SetDoc> = {}): SetDoc {
  return {
    id: newId(),
    warmup: false,
    target: { ...noMeasures, repsMax: null },
    actual: { ...noMeasures },
    custom: {},
    loggedAt: null,
    ...overrides,
  };
}

export function isLogged(set: Pick<SetDoc, "loggedAt">): boolean {
  return set.loggedAt !== null;
}

/** A set can only be marked done once it records something countable. Load or RPE alone say nothing. */
export function hasResult(set: Pick<SetDoc, "actual" | "custom">): boolean {
  return set.actual.reps !== null || set.actual.duration !== null || set.actual.distance !== null ||
    Object.keys(set.custom).length > 0;
}

// Calendar days -------------------------------------------------------------

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday is 0, Sunday is 6. */
export function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the ISO week that holds this day. */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** ISO 8601 week number and the year that week belongs to. */
export function isoWeek(day: string): { year: number; week: number } {
  const thursday = new Date(`${addDays(weekStart(day), 3)}T00:00:00Z`);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstWeekStart = Date.UTC(year, 0, 4 - ((firstThursday.getUTCDay() + 6) % 7));
  return { year, week: Math.round((thursday.valueOf() - 3 * 86_400_000 - firstWeekStart) / (7 * 86_400_000)) + 1 };
}

/** Today's calendar day in Stockholm, where the log is kept. */
export function stockholmDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((part) => parts.find(({ type }) => type === part)?.value).join("-");
}

// Numbers as lifters write them --------------------------------------------

const plain = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2, useGrouping: false });
const grouped = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** 97.5, 140, 82.25: no trailing zeros, no thousands separator. */
export function formatNumber(value: number): string {
  return plain.format(value);
}

/** Volume totals: 34 250 with a thin space, as Swedish tables set thousands. */
export function formatTotal(value: number): string {
  return grouped.format(Math.round(value)).replace(/,/g, " ");
}

/** 0:45, 1:30, 31:30, 1:02:05: one clock format, so times in a column compare. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** 400 m, 5.2 km. */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${formatNumber(meters)} m` : `${formatNumber(Math.round(meters / 10) / 100)} km`;
}

/** Session length for people: 58 min, 1 h, 1 h 4 min. */
export function formatSpan(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  return total % 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total / 60} h`;
}

/**
 * One set in a lifter's notation: "140 × 5", "× 8" for unloaded reps, "+10 × 6" for
 * added weight on a bodyweight exercise, "1:00" for time, "5.2 km in 31:30".
 * Returns an empty string when the measures say nothing.
 */
export function setNotation(measures: Measures, tracking: Tracking = "weight_reps"): string {
  const { reps, load, duration, distance } = measures;
  const parts: string[] = [];
  if (distance !== null) parts.push(duration !== null ? `${formatDistance(distance)} in ${formatDuration(duration)}` : formatDistance(distance));
  else if (duration !== null) parts.push(formatDuration(duration));
  if (reps !== null) {
    const weight = load === null || (load === 0 && tracking === "bodyweight_reps") ? ""
      : `${tracking === "bodyweight_reps" ? "+" : ""}${formatNumber(load)} `;
    parts.push(`${weight}× ${reps}`);
  } else if (load !== null && distance === null && duration === null) {
    parts.push(`${formatNumber(load)} kg`);
  } else if (load !== null && load > 0) {
    parts.push(`${formatNumber(load)} kg`);
  }
  return parts.join(", ");
}

/** "5", "8–12", "" when no rep target was set. */
export function repTarget(target: Pick<SetTarget, "reps" | "repsMax">): string {
  if (target.reps === null) return target.repsMax === null ? "" : `${target.repsMax}`;
  return target.repsMax !== null && target.repsMax > target.reps ? `${target.reps}–${target.repsMax}` : `${target.reps}`;
}

// Loads ----------------------------------------------------------------------

/**
 * The plates on one sleeve for a barbell load, heaviest first. Returns null when the
 * load is lighter than the bar or cannot be made from pairs of the given plates.
 */
export function platesPerSide(
  loadKg: number, barKg: number = STANDARD_BAR_KG, plates: readonly number[] = PLATES_KG,
): number[] | null {
  if (!Number.isFinite(loadKg) || !Number.isFinite(barKg) || loadKg < barKg) return null;
  // Work in grams so 1.25 kg plates never meet floating point.
  let side = Math.round((loadKg - barKg) * 1000) / 2;
  if (!Number.isInteger(side)) return null;
  const stack: number[] = [];
  for (const plate of plates) {
    const grams = Math.round(plate * 1000);
    while (side >= grams && stack.length < 16) {
      stack.push(plate);
      side -= grams;
    }
  }
  return side === 0 ? stack : null;
}

// Reading a workout ---------------------------------------------------------

export function allSets(doc: Pick<WorkoutDoc, "blocks">): SetDoc[] {
  return doc.blocks.flatMap((block) => block.sets);
}

export function loggedCount(doc: Pick<WorkoutDoc, "blocks">): number {
  return allSets(doc).filter(isLogged).length;
}

/** The first set not yet done, in workout order: where the lifter is. */
export function nextSet(doc: Pick<WorkoutDoc, "blocks">): { block: BlockDoc; set: SetDoc; index: number } | null {
  for (const block of doc.blocks) {
    const index = block.sets.findIndex((set) => !isLogged(set));
    if (index !== -1) return { block, set: block.sets[index], index };
  }
  return null;
}

export type WorkSummary = { workSets: number; volume: number; averageRpe: number | null };

/** Totals over logged working sets. Warm-ups and undone sets never count. */
export function summarizeSets(sets: readonly Pick<SetDoc, "warmup" | "actual" | "loggedAt">[]): WorkSummary {
  const work = sets.filter((set) => isLogged(set) && !set.warmup);
  const ratings = work.flatMap((set) => (set.actual.rpe === null ? [] : [set.actual.rpe]));
  return {
    workSets: work.length,
    volume: work.reduce((total, set) => total + (set.actual.reps ?? 0) * (set.actual.load ?? 0), 0),
    averageRpe: ratings.length ? ratings.reduce((total, rpe) => total + rpe, 0) / ratings.length : null,
  };
}

export type SetRun = { measures: Measures; warmup: boolean; count: number };

/**
 * Collapse neighbouring identical sets so three sets of 140 × 5 read as one line
 * with a count of three. RPE is ignored for the comparison and dropped from a run
 * that mixes ratings.
 */
export function collapseSets(sets: readonly { measures: Measures; warmup: boolean }[]): SetRun[] {
  const runs: SetRun[] = [];
  for (const { measures, warmup } of sets) {
    const last = runs.at(-1);
    const same = last && last.warmup === warmup && last.measures.reps === measures.reps &&
      last.measures.load === measures.load && last.measures.duration === measures.duration &&
      last.measures.distance === measures.distance;
    if (last && same) {
      last.count += 1;
      if (last.measures.rpe !== measures.rpe) last.measures = { ...last.measures, rpe: null };
    } else {
      runs.push({ measures: { ...measures }, warmup, count: 1 });
    }
  }
  return runs;
}

/**
 * The heaviest logged working set of a block, ties broken by reps. This is the
 * set a session is remembered by, and the one drawn as a loaded bar.
 */
export function topSet<T extends Pick<SetDoc, "warmup" | "actual" | "loggedAt">>(sets: readonly T[]): T | null {
  let best: T | null = null;
  for (const set of sets) {
    if (!isLogged(set) || set.warmup || set.actual.load === null || set.actual.reps === null) continue;
    if (!best || set.actual.load > best.actual.load! ||
      (set.actual.load === best.actual.load && set.actual.reps > best.actual.reps!)) best = set;
  }
  return best;
}

// Checking a draft before it is saved --------------------------------------

export class WorkoutInputError extends Error {}

/** Postgres text cannot hold U+0000; a crafted request must come back as an input error, not a database error. */
export function rejectNul(value: string, what: string): string {
  if (value.includes("\u0000")) throw new WorkoutInputError(`${what} contains an unsupported character.`);
  return value;
}

/** Earliest time a set can have been logged. Anything older is a typo or a crafted value. */
export const EARLIEST_LOGGED_AT = Date.UTC(2000, 0, 1);

type Context = {
  status: WorkoutStatus;
  /** Ids of every exercise that exists, archived or not. */
  exerciseIds: ReadonlySet<string>;
  fields: readonly FieldInfo[];
  /** Today in Stockholm; completed sessions cannot be dated after it. */
  today: string;
  now?: Date;
};

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkoutInputError(`${what} is not readable. Reload the page and try again.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string, max: number, required = false): string {
  if (typeof value !== "string") throw new WorkoutInputError(`${what} is missing.`);
  const trimmed = rejectNul(value, what).trim();
  if (required && !trimmed) throw new WorkoutInputError(`Give ${what.toLowerCase()} a value.`);
  if (trimmed.length > max) throw new WorkoutInputError(`${what} can be at most ${max} characters.`);
  return trimmed;
}

function amount(value: unknown, what: string, min: number, max: number, integer = false): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
    (integer && !Number.isInteger(value))) {
    throw new WorkoutInputError(`${what} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
  }
  return Math.round(value * 1000) / 1000;
}

function measures(value: unknown, what: string): Measures {
  const input = record(value, what);
  return {
    reps: amount(input.reps, `${what} reps`, 0, limits.reps, true),
    load: amount(input.load, `${what} load`, 0, limits.loadKg),
    rpe: amount(input.rpe, `${what} RPE`, 1, 10),
    duration: amount(input.duration, `${what} time`, 0, limits.durationSeconds),
    distance: amount(input.distance, `${what} distance`, 0, limits.distanceMeters),
  };
}

function customValues(value: unknown, fields: readonly FieldInfo[], exerciseId: string, what: string): CustomValues {
  const input = record(value ?? {}, `${what} extra fields`);
  const values: CustomValues = {};
  for (const field of fields) {
    if (field.exerciseId !== null && field.exerciseId !== exerciseId) continue;
    const raw = input[field.id];
    if (raw === undefined || raw === null || raw === "") continue;
    if (field.kind === "text") {
      const entry = text(raw, field.label, limits.customText);
      if (entry) values[field.id] = entry;
    } else {
      const entry = amount(raw, field.label, -1e9, 1e9, field.kind === "integer");
      if (entry !== null) values[field.id] = entry;
    }
  }
  return values;
}

/**
 * Check a draft sent by the editor and return it cleaned. Throws WorkoutInputError
 * with a message fit to show the owner. Unknown properties are dropped, values for
 * custom fields that no longer exist are dropped, and a template keeps only targets.
 */
export function parseWorkoutDraft(input: unknown, context: Context): WorkoutDraft {
  const draft = record(input, "The workout");
  const template = context.status === "template";
  const title = text(draft.title, "The name", limits.title, true);
  const notes = text(draft.notes ?? "", "Notes", limits.notes);

  let day: string | null = null;
  if (!template) {
    if (!isDay(draft.day)) throw new WorkoutInputError("Enter a valid date.");
    day = draft.day;
    if (context.status === "completed" && day > context.today) {
      throw new WorkoutInputError("A completed session must be dated today or earlier.");
    }
  }

  if (!Array.isArray(draft.blocks)) throw new WorkoutInputError("The workout is not readable. Reload the page and try again.");
  if (draft.blocks.length > limits.blocks) throw new WorkoutInputError(`A workout can hold at most ${limits.blocks} exercises.`);

  const seen = new Set<string>();
  const unique = (id: unknown, what: string) => {
    if (!isId(id) || seen.has(id.toLowerCase())) throw new WorkoutInputError(`${what} is not readable. Reload the page and try again.`);
    seen.add(id.toLowerCase());
    return id.toLowerCase();
  };
  const latest = (context.now ?? new Date()).valueOf() + 5 * 60_000;

  const blocks = draft.blocks.map((rawBlock, blockIndex): BlockDoc => {
    const block = record(rawBlock, `Exercise ${blockIndex + 1}`);
    const id = unique(block.id, `Exercise ${blockIndex + 1}`);
    if (!isId(block.exerciseId) || !context.exerciseIds.has(block.exerciseId.toLowerCase())) {
      throw new WorkoutInputError(`Exercise ${blockIndex + 1} is no longer in the library. Remove it or pick another.`);
    }
    const exerciseId = block.exerciseId.toLowerCase();
    if (!Array.isArray(block.sets)) throw new WorkoutInputError(`Exercise ${blockIndex + 1} is not readable.`);
    if (block.sets.length > limits.setsPerBlock) {
      throw new WorkoutInputError(`An exercise can hold at most ${limits.setsPerBlock} sets.`);
    }
    const sets = block.sets.map((rawSet, setIndex): SetDoc => {
      const what = `Set ${setIndex + 1} of exercise ${blockIndex + 1}`;
      const set = record(rawSet, what);
      const target = record(set.target ?? {}, `${what} target`);
      const targetMeasures = measures(target, `${what} target`);
      let repsMax = amount(target.repsMax, `${what} target reps`, 0, limits.reps, true);
      if (repsMax !== null && (targetMeasures.reps === null || repsMax <= targetMeasures.reps)) repsMax = null;
      const cleaned: SetDoc = {
        id: unique(set.id, what),
        warmup: set.warmup === true,
        target: { ...targetMeasures, repsMax },
        actual: template ? { ...noMeasures } : measures(set.actual ?? {}, what),
        custom: template ? {} : customValues(set.custom, context.fields, exerciseId, what),
        loggedAt: null,
      };
      if (!template && set.loggedAt !== null && set.loggedAt !== undefined) {
        const stamp = typeof set.loggedAt === "string" ? new Date(set.loggedAt) : null;
        if (!stamp || Number.isNaN(stamp.valueOf())) throw new WorkoutInputError(`${what} has an unreadable time.`);
        if (!hasResult(cleaned)) {
          throw new WorkoutInputError(`${what} is marked done but records nothing. Enter reps, time or distance.`);
        }
        if (stamp.valueOf() < EARLIEST_LOGGED_AT) throw new WorkoutInputError(`${what} has a time before the year 2000.`);
        cleaned.loggedAt = new Date(Math.min(stamp.valueOf(), latest)).toISOString();
      }
      return cleaned;
    });
    return {
      id,
      exerciseId,
      notes: text(block.notes ?? "", "Exercise notes", limits.blockNotes),
      restSeconds: amount(block.restSeconds, "Rest", 0, limits.restSeconds, true),
      sets,
    };
  });

  if (context.status === "completed" && !blocks.some((block) => block.sets.some(isLogged))) {
    throw new WorkoutInputError("A completed session needs at least one logged set.");
  }
  return { title, day, notes, blocks };
}
