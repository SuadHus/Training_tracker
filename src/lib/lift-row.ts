// The words and counters of the row that holds the lifter's stage: the sentence a screen reader gets for the drawing, the plate line,
// the short names of the tabs and the rep counter. Pure, so the page and the tests share them; React writes the row itself.

import { liftNames, MAX_DRAWN_REPS, type LiftKind } from "./lifts";
import type { RepCount } from "./lift-set";
import { formatNumber, platesPerSide } from "./workout-doc";

/** The top set of a main lift of the week, as the page hands it to the stage: plain data. */
export type MainLift = {
  kind: LiftKind;
  /** The exercise's own name, as the owner wrote it. */
  exercise: string;
  loadKg: number;
  barKg: number;
  reps: number;
  rpe: number | null;
  /** The day, already formatted: "Fri 27 Nov". */
  day: string;
};

/** The plates on one sleeve of a lift. Only lifts that `topLifts` lists are drawn, and for those the load can be made from plates. */
export function platesOf(lift: MainLift): number[] {
  const plates = platesPerSide(lift.loadKg, lift.barKg);
  if (!plates) throw new Error(`${lift.loadKg} kg cannot be made from plates`);
  return plates;
}

/** The reps the stage draws: the lift's, at most as many as the model can do. */
export const drawnReps = (lift: MainLift) => Math.min(MAX_DRAWN_REPS, Math.max(1, Math.round(lift.reps)));

/** What a tab says on a phone. */
const SHORT_NAMES: Record<LiftKind, string> = {
  "squat-low": "Low bar", "squat-high": "High bar", bench: "Bench", "bench-close": "Close grip", "deadlift-conventional": "Deadlift", "deadlift-sumo": "Sumo",
};
export const shortName = (kind: LiftKind) => SHORT_NAMES[kind];

const DESCRIPTIONS: Record<LiftKind, string> = {
  "squat-low": "The bar sits low across the rear delts, the torso leans far forward and the hips go back.",
  "squat-high": "The bar sits on top of the traps and the torso stays fairly upright.",
  bench: "Hands well outside the shoulders, elbows flared.",
  "bench-close": "Hands about shoulder width apart, elbows tucked in.",
  "deadlift-conventional": "Feet hip width, hands just outside the legs.",
  "deadlift-sumo": "Feet very wide, toes out, hands inside the legs.",
};

const STARTS: Record<LiftKind, string> = {
  "squat-low": "It starts in the rack: unrack, walk out, squat, and walk the bar back into the hooks.",
  "squat-high": "It starts in the rack: unrack, walk out, squat, and walk the bar back into the hooks.",
  bench: "It starts in the hooks: lift off, press, and put the bar back in the hooks.",
  "bench-close": "It starts in the hooks: lift off, press, and put the bar back in the hooks.",
  "deadlift-conventional": "The bar starts on the floor: walk up, set, pull, and put it down.",
  "deadlift-sumo": "The bar starts on the floor: walk up, step wide, pull, and put it down.",
};

/** The sentence a screen reader gets for the drawing. */
export function altText(lift: MainLift, plates: readonly number[], reps: number): string {
  const name = lift.exercise || liftNames[lift.kind];
  const load = `${formatNumber(lift.loadKg)} kilograms for ${reps} ${reps === 1 ? "rep" : "reps"}.`;
  const sleeves = plates.length ? `${plates.map(formatNumber).join(", ")} kilograms on each side.` : "The empty bar.";
  return `${name}, ${load} ${sleeves} ${DESCRIPTIONS[lift.kind]} ${STARTS[lift.kind]}`;
}

/** More plates than this on a sleeve are written as a count, so that the caption is as long for every load. */
export const LONG_STACK = 6;

/** A sleeve of more than `LONG_STACK` plates in the site's notation, with each run of equal plates as a count: "7 × 25 + 10". */
export function countedPlates(plates: readonly number[]): string {
  const runs: string[] = [];
  for (let from = 0; from < plates.length;) {
    let to = from;
    while (to < plates.length && plates[to] === plates[from]) to++;
    runs.push(to - from > 1 ? `${to - from} × ${formatNumber(plates[from])}` : formatNumber(plates[from]));
    from = to;
  }
  return runs.join(" + ");
}

// ------------------------------------------------------------------------------------------------ the rep counter

/** Reps beyond this get no row of squares: the words say it. */
export const MAX_SQUARES = 12;

/** What the counter shows: the rep under way (or, between reps, the next), how many are finished, and the word for the phase. A finished set shows all its reps done. */
export type Counter = { shown: number; done: number; total: number; phase: string };

/** The counter for a set at an instant: `at` is the rep count of that instant, `finished` the set having played to its end. */
export function counterOf(total: number, at: RepCount, phase: string, finished: boolean): Counter {
  if (finished) return { shown: total, done: total, total, phase: "done" };
  return { shown: at.rep || Math.min(total, at.done + 1), done: at.done, total, phase };
}

/** The class of each square: "done", "now" or "". */
export const squareClasses = (c: Counter): string[] => Array.from({ length: Math.min(c.total, MAX_SQUARES) }, (_, i) => (i + 1 <= c.done ? "done" : i + 1 === c.shown ? "now" : ""));
