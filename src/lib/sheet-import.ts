// Reading workouts out of rows copied from a spreadsheet, as lifters keep them:
// one exercise per row with sets, reps and a load or a remark, several workouts
// side by side, weeks stacked under each other. Pure: no database, no clock.
import { dateLabel } from "./day-format";
import {
  addDays, emptySet, formatDuration, formatNumber, isDay, limits, newId, weekdayIndex,
  type BlockDoc, type Equipment, type SetDoc, type Tracking, type WorkoutDraft,
} from "./workout-doc";

/** One spreadsheet row: so many sets of the same thing. */
export type SheetRow = {
  count: number;
  reps: number | null;
  repsMax: number | null;
  load: number | null;
  rpe: number | null;
  duration: number | null;
};

/** Neighbouring rows of the same exercise, read as one block. */
export type SheetEntry = {
  name: string;
  rows: SheetRow[];
  notes: string[];
  /** The sheet said "bw" somewhere: reps on bodyweight, perhaps with added weight. */
  bodyweight: boolean;
};

export type SheetWorkout = {
  day: string | null;
  label: string | null;
  entries: SheetEntry[];
  /** Which stacked group of the sheet it sits in, from the top: sheets keep one week per group. */
  section: number;
};

export const sheetLimits = { characters: 200_000, rows: 4000, columns: 120, workouts: 30, weeks: 16, sessionsPerWeek: 7 } as const;

const number = (text: string) => Number(text.replace(",", "."));
const amount = "(\\d+(?:[.,]\\d+)?)";

function clean(cell: string): string {
  return cell.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The text as rows of cells. A program is a few hundred rows and a few dozen columns;
 * what lies beyond `sheetLimits.rows` and `sheetLimits.columns` is cut off, which keeps
 * the reading quick whatever is pasted. `clipped` says that something was cut.
 */
function table(text: string): { rows: string[][]; clipped: boolean } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tabbed = lines.some((line) => line.includes("\t"));
  let clipped = lines.length > sheetLimits.rows;
  // Without tabs the text was typed or came from a document: two or more spaces separate cells.
  const rows = lines.slice(0, sheetLimits.rows).map((line) => {
    const cells = tabbed ? line.split("\t") : line.trim().split(/\s{2,}|\s*\|\s*/);
    if (cells.length > sheetLimits.columns && cells.slice(sheetLimits.columns).some((cell) => cell.trim())) clipped = true;
    return cells.slice(0, sheetLimits.columns).map(clean);
  });
  return { rows, clipped };
}

/** Runs of neighbouring columns that hold anything: each run is one workout column. */
function columnGroups(rows: string[][]): Array<[number, number]> {
  const used: boolean[] = [];
  for (const row of rows) row.forEach((cell, column) => { if (cell) used[column] = true; });
  const width = used.length;
  const groups: Array<[number, number]> = [];
  for (let column = 0; column < width; column += 1) {
    if (!used[column]) continue;
    let end = column;
    while (end + 1 < width && used[end + 1]) end += 1;
    groups.push([column, end]);
    column = end;
  }
  return groups;
}

// isDay narrows its argument, so it is asked through a plain yes-or-no here.
const realDay: (text: string) => boolean = isDay;

function dayOf(text: string): string | null {
  if (realDay(text)) return text;
  const dotted = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!dotted) return null;
  const day = `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
  return realDay(day) ? day : null;
}

const headingWords = /^(day|dag|week|vecka|session|pass|workout|w\d|d\d)\b/i;
const columnHeads = /^(exercise|övning|lift|movement|sets?|reps?|weight|load|kg|vikt|notes?|rpe)$/i;

function readSets(text: string): { count: number; note: string | null } {
  if (!text) return { count: 1, note: null };
  if (/^\d+$/.test(text)) return { count: Math.max(1, Number(text)), note: null };
  const parts = text.match(/^(\d+)\s*\+\s*(\d+)/);
  if (parts) return { count: Number(parts[1]) + Number(parts[2]), note: `Sets: ${text}` };
  return { count: 1, note: text };
}

function readReps(text: string): Pick<SheetRow, "reps" | "repsMax" | "duration"> & { note: string | null } {
  const none = { reps: null, repsMax: null, duration: null, note: null };
  if (!text) return none;
  if (/^\d+$/.test(text)) return { ...none, reps: Number(text) };
  const range = text.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (range) return { ...none, reps: Number(range[1]), repsMax: Number(range[2]) };
  const clock = text.match(/^(\d+):(\d\d)$/);
  if (clock) return { ...none, duration: Number(clock[1]) * 60 + Number(clock[2]) };
  const seconds = text.match(new RegExp(`^${amount}\\s*(s|sec|secs|seconds|sek)$`, "i"));
  if (seconds) return { ...none, duration: number(seconds[1]) };
  const minutes = text.match(new RegExp(`^${amount}\\s*(m|min|mins|minutes)$`, "i"));
  if (minutes) return { ...none, duration: number(minutes[1]) * 60 };
  return { ...none, note: text };
}

/** The last cells of a row: a load, an effort, "bw", or a remark in the lifter's own words. */
function readRest(text: string): { load: number | null; rpe: number | null; bodyweight: boolean; note: string | null } {
  let left = text;
  let load: number | null = null;
  let rpe: number | null = null;
  let bodyweight = false;
  const take = (pattern: RegExp, use: (match: RegExpMatchArray) => void) => {
    const match = left.match(pattern);
    if (!match) return;
    use(match);
    left = clean(left.replace(match[0], " "));
  };
  take(new RegExp(`rpe\\s*${amount}`, "i"), (match) => { rpe = number(match[1]); });
  take(new RegExp(`\\bbw\\s*\\+\\s*${amount}\\s*(?:kg)?`, "i"), (match) => { bodyweight = true; load = number(match[1]); });
  take(/\b(bw|bodyweight|kroppsvikt)\b/i, () => { bodyweight = true; });
  take(new RegExp(`${amount}\\s*kg\\b`, "i"), (match) => { load ??= number(match[1]); });
  if (new RegExp(`^${amount}$`).test(left)) {
    load ??= number(left);
    left = "";
  }
  if (rpe !== null && (rpe < 1 || rpe > 10)) rpe = null;
  return { load, rpe, bodyweight, note: left || null };
}

/** Two spellings of one exercise share a key: "Pullups " and "Pull-up" both give "pullup". */
export function sheetKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9åäö]+/g, "").replace(/s$/, "");
}

/** The name as the lifter wrote it, tidied: single spaces, a capital first letter. */
export function tidyName(name: string): string {
  const tidy = clean(name).replace(/\s*\(\s*/g, " (").replace(/\s+\)/g, ")");
  return tidy.charAt(0).toUpperCase() + tidy.slice(1);
}

function entriesOf(rows: string[][]): SheetEntry[] {
  const entries: SheetEntry[] = [];
  let lastName = "";
  for (const cells of rows) {
    const [first = "", setsText = "", repsText = "", ...others] = cells;
    if (columnHeads.test(first) && (!setsText || columnHeads.test(setsText))) continue;
    const name = first || lastName;
    if (!name) continue;
    lastName = name;
    const sets = readSets(setsText);
    const reps = readReps(repsText);
    const rest = readRest(others.filter(Boolean).join(" "));
    const row: SheetRow = {
      count: Math.min(sets.count, limits.setsPerBlock),
      reps: reps.reps, repsMax: reps.repsMax, duration: reps.duration, load: rest.load, rpe: rest.rpe,
    };
    const notes = [sets.note, reps.note, rest.note].filter((note): note is string => Boolean(note));
    const last = entries.at(-1);
    if (last && sheetKey(last.name) === sheetKey(name)) {
      last.rows.push(row);
      for (const note of notes) if (!last.notes.includes(note)) last.notes.push(note);
      last.bodyweight ||= rest.bodyweight;
    } else {
      entries.push({ name: tidyName(name), rows: [row], notes, bodyweight: rest.bodyweight });
    }
  }
  return entries;
}

/**
 * Every workout found in the pasted text, left to right and top to bottom.
 * A workout is a run of rows in one column group; a blank row ends it. Its first
 * row may be a date or a heading such as "Day 1".
 */
export function parseSheet(text: string): SheetWorkout[] {
  return readSheet(text).workouts;
}

/**
 * The workouts of a sheet, and how many it holds in all: only the first `sheetLimits.workouts`
 * are read. `clipped` is true when the text was longer or wider than is read at all.
 */
export function readSheet(text: string): { workouts: SheetWorkout[]; found: number; clipped: boolean } {
  const { rows, clipped } = table(text.slice(0, sheetLimits.characters));
  const workouts: Array<Omit<SheetWorkout, "section"> & { top: number; left: number }> = [];
  for (const [start, end] of columnGroups(rows)) {
    let block: string[][] = [];
    let top = 0;
    const close = () => {
      if (!block.length) return;
      let day: string | null = null;
      let label: string | null = null;
      const [first, ...others] = block[0];
      if (first && others.every((cell) => !cell)) {
        day = dayOf(first);
        if (day || headingWords.test(first)) {
          if (!day) label = first;
          block = block.slice(1);
        }
      }
      const entries = entriesOf(block);
      if (entries.length) workouts.push({ day, label, entries, top, left: start });
      block = [];
    };
    rows.forEach((row, index) => {
      const cells = row.slice(start, end + 1);
      if (cells.some(Boolean)) {
        if (!block.length) top = index;
        block.push(cells);
      } else close();
    });
    close();
  }
  // Reading order: a section at a time (workouts whose first rows sit together), then left to right.
  workouts.sort((a, b) => a.top - b.top || a.left - b.left);
  let section = 0;
  const placed = workouts.map((workout, index) => {
    if (index > 0 && workout.top - workouts[index - 1].top > 1) section += 1;
    return { workout, section };
  });
  placed.sort((a, b) => a.section - b.section || a.workout.left - b.workout.left);
  return {
    workouts: placed.slice(0, sheetLimits.workouts).map(({ workout: { day, label, entries }, section: at }) => ({ day, label, entries, section: at })),
    found: placed.length,
    clipped: clipped || text.length > sheetLimits.characters,
  };
}

/** Which days of a training week (its first day is 0) so many sessions usually fall on. */
export function usualWeekdays(count: number): number[] {
  const usual: Record<number, number[]> = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5],
  };
  return usual[count] ?? Array.from({ length: Math.min(count, 7) }, (_, index) => index);
}

const daysApart = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type PlannedWeek = { week: number; sessions: Array<{ index: number; day: string }> };

/**
 * Lay a sheet out as the weeks of a training block whose first week starts on `start`:
 * each stacked group is a week, each workout in it a session. Dates in the sheet only
 * say how the sessions are spread over a week; a week without dates borrows the spread
 * of a dated week of the same size, or the usual one. A block holds `sheetLimits.weeks`
 * weeks of `sheetLimits.sessionsPerWeek` sessions; what does not fit is left out.
 */
export function planBlock(workouts: readonly SheetWorkout[], start: string, newestFirst = false): PlannedWeek[] {
  const every = [...new Set(workouts.map((workout) => workout.section))].sort((a, b) => a - b);
  if (newestFirst) every.reverse();
  const sections = every.slice(0, sheetLimits.weeks);
  const members = (section: number) => workouts.map((workout, index) => ({ workout, index }))
    .filter(({ workout }) => workout.section === section).slice(0, sheetLimits.sessionsPerWeek);
  const written = (section: number): number[] | null => {
    const days = members(section).map(({ workout }) => workout.day);
    if (!days.length || days.some((day) => !day)) return null;
    const spread = days.map((day) => daysApart(days[0]!, day!));
    return spread.every((offset, at) => offset < 7 && (at === 0 || offset > spread[at - 1])) ? spread : null;
  };
  return sections.map((section, at) => {
    const sessions = members(section);
    const borrowed = sections.map(written).find((spread) => spread?.length === sessions.length);
    const spread = written(section) ?? borrowed ?? usualWeekdays(sessions.length);
    return { week: at + 1, sessions: sessions.map(({ index }, slot) => ({ index, day: addDays(start, 7 * at + spread[slot]) })) };
  });
}

/** A first day for a pasted block: the next day, from today on, that falls on the weekday the sheet's weeks start on. */
export function suggestStart(workouts: readonly SheetWorkout[], today: string): string {
  const first = workouts.find((workout) => workout.day)?.day;
  if (!first) return today;
  return addDays(today, (weekdayIndex(first) - weekdayIndex(today) + 7) % 7);
}

export type ExerciseGuess = { tracking: Tracking; equipment: Equipment; primaryMuscle: string };

const muscles: Array<[RegExp, string]> = [
  [/leg curl|\brdl\b|hamstring|good morning/, "Hamstrings"],
  [/tricep/, "Triceps"],
  [/bicep|\bcurls?\b/, "Biceps"],
  [/bench|chest(?! supported)|push[ -]?up|dumb?bell press|\bdips?\b|\bfl[iy]es?\b/, "Chest"],
  [/deadlift/, "Back"],
  [/squat|\bssb\b|leg press|leg extension|step[ -]?up|lunge/, "Quads"],
  [/\brows?\b|pull[ -]?up|chin[ -]?up|\blat\b|pulldown|back extension/, "Back"],
  [/overhead|shoulder|lateral|military|\bohp\b/, "Shoulders"],
  [/plank|plance|\bcore\b|leg raise|\babs?\b|crunch|sit[ -]?up/, "Core"],
  [/glute|hip thrust|good girls|bad girls|abduct|adduct|sumo/, "Glutes"],
  [/cal(f|ves)/, "Calves"],
  [/jump|\bleg\b/, "Legs"],
];

/** A first reading of what an exercise is, from its name and its rows. The owner can correct it in the library. */
export function guessExercise(entry: SheetEntry): ExerciseGuess {
  const name = entry.name.toLowerCase();
  const timed = entry.rows.some((row) => row.duration !== null) || /plank|plance|stretch|\bhold\b|\bhang\b|carry|wall sit/.test(name);
  const ownWeight = entry.bodyweight ||
    /pull[ -]?ups?|chin[ -]?ups?|push[ -]?ups?|\bdips?\b|back extensions?|leg raises?|step[ -]?ups?|\bjumps?\b|sit[ -]?ups?|crunch/.test(name);
  const tracking: Tracking = timed ? "duration" : ownWeight ? "bodyweight_reps" : "weight_reps";

  const oneSided = /\b(1|one|single)[ -]?leg\b|\buni\b|unilateral/.test(name);
  let equipment: Equipment = "other";
  if (/dumb?bell|\bdb\b/.test(name)) equipment = "dumbbell";
  else if (/kettle|\bkb\b/.test(name)) equipment = "kettlebell";
  else if (/cable|pulldown|pushdown|face pull/.test(name)) equipment = "cable";
  else if (/machine|leg (press|curl|extension)|hack|smith|pec deck|good girls|bad girls|abduct|adduct|chest supported/.test(name)) equipment = "machine";
  else if (tracking !== "weight_reps") equipment = /stretch/.test(name) ? "other" : "bodyweight";
  else if (!oneSided && /squat|\bssb\b|bench|deadlift|\brdl\b|overhead press|military|clean|snatch|jerk|good morning|hip thrust|barbell|\brows?\b/.test(name)) equipment = "barbell";

  const primaryMuscle = muscles.find(([pattern]) => pattern.test(name))?.[1] ?? (/\blat\b/.test(name) ? "Back" : "Full body");
  return { tracking, equipment, primaryMuscle };
}

/** What a workout is called as a session of a block: its heading, or its first two exercises. */
export function sessionName(workout: SheetWorkout): string {
  const names = [...new Set(workout.entries.map((entry) => entry.name))].slice(0, 2).join(" + ");
  return (workout.label ?? names).slice(0, limits.title);
}

/** A name for a workout that came without one: its first two exercises, and its date when it has one. */
export function suggestTitle(workout: SheetWorkout): string {
  if (workout.label || !workout.day) return sessionName(workout);
  return `${sessionName(workout)}, ${dateLabel(workout.day)}`.slice(0, limits.title);
}

/** One row in words: "100 × 2 × 2", "6–8 reps, RPE 10", "1:00", or "2 sets" when it gives no numbers. */
export function rowLabel(row: SheetRow, tracking: Tracking): string {
  const parts: string[] = [];
  const seconds = row.duration ?? (tracking === "duration" ? row.reps : null);
  if (seconds !== null) parts.push(formatDuration(seconds));
  else {
    const reps = row.reps === null ? "" : row.repsMax !== null && row.repsMax > row.reps ? `${row.reps}–${row.repsMax}` : `${row.reps}`;
    const weight = row.load === null ? "" : `${tracking === "bodyweight_reps" ? "+" : ""}${formatNumber(row.load)}`;
    if (weight && reps) parts.push(`${weight} × ${reps}`);
    else if (reps) parts.push(`${reps} reps`);
    else if (weight) parts.push(`${weight} kg`);
  }
  if (!parts.length) parts.push(row.count === 1 ? "1 set" : `${row.count} sets`);
  else if (row.count > 1) parts[0] = `${parts[0]} × ${row.count}`;
  if (row.rpe !== null) parts.push(`RPE ${formatNumber(row.rpe)}`);
  return parts.join(", ");
}

/** The workout as a template draft. `exercise` says which library exercise each entry is and what it records. */
export function buildDraft(
  workout: SheetWorkout, title: string, exercise: (entry: SheetEntry) => { id: string; tracking: Tracking },
): WorkoutDraft {
  const blocks = workout.entries.slice(0, limits.blocks).map((entry): BlockDoc => {
    const { id, tracking } = exercise(entry);
    const sets: SetDoc[] = [];
    for (const row of entry.rows) {
      for (let made = 0; made < row.count && sets.length < limits.setsPerBlock; made += 1) {
        const timed = tracking === "duration" || tracking === "distance_duration";
        const target = {
          // In a time exercise a bare number in the reps column is seconds.
          reps: timed ? null : row.reps,
          repsMax: timed ? null : row.repsMax,
          load: row.load,
          rpe: row.rpe,
          duration: timed ? row.duration ?? row.reps : row.duration,
          distance: null,
        };
        sets.push(emptySet({ id: newId(), target }));
      }
    }
    return { id: newId(), exerciseId: id, notes: entry.notes.join(". ").slice(0, limits.blockNotes), restSeconds: null, sets };
  });
  return { title, day: null, notes: "", blocks };
}
