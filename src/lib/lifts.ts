// The six lifts the home page can draw in motion, and which exercise is which.
// An exercise is recognised by its name, strictly: a name that might be another
// lift (front squat, incline bench, Romanian deadlift) is not drawn at all, because
// the wrong movement on a public page is worse than a still bar.
// Pure, so the library, the page and the tests share it.

import { platesPerSide, STANDARD_BAR_KG, type Equipment, type Measures } from "./workout-doc";

export const LIFT_KINDS = [
  "squat-low", "squat-high", "bench", "bench-close", "deadlift-conventional", "deadlift-sumo",
] as const;
export type LiftKind = (typeof LIFT_KINDS)[number];
export type LiftFamily = "squat" | "bench" | "deadlift";

/** The plain name of each lift. An exercise with exactly this name is drawn as that lift. */
export const liftNames: Record<LiftKind, string> = {
  "squat-low": "Low bar squat",
  "squat-high": "High bar squat",
  bench: "Bench press",
  "bench-close": "Close grip bench press",
  "deadlift-conventional": "Conventional deadlift",
  "deadlift-sumo": "Sumo deadlift",
};

export function liftFamily(kind: LiftKind): LiftFamily {
  return kind.startsWith("squat") ? "squat" : kind.startsWith("bench") ? "bench" : "deadlift";
}

/** Abbreviations lifters write, spelled out. */
const shorthand: Record<string, string[]> = {
  lbbs: ["low", "bar", "squat"],
  hbbs: ["high", "bar", "squat"],
  cgbp: ["close", "grip", "bench"],
  lowbar: ["low", "bar"],
  highbar: ["high", "bar"],
  closegrip: ["close", "grip"],
};

const familyWords: Record<string, LiftFamily> = {
  squat: "squat", squats: "squat",
  bench: "bench",
  deadlift: "deadlift", deadlifts: "deadlift", dl: "deadlift",
};

/** The words that pick one lift within its family. */
const variants: Record<LiftFamily, Array<{ phrase: string[]; kind: LiftKind }>> = {
  squat: [{ phrase: ["low", "bar"], kind: "squat-low" }, { phrase: ["high", "bar"], kind: "squat-high" }],
  bench: [{ phrase: ["close", "grip"], kind: "bench-close" }, { phrase: ["narrow", "grip"], kind: "bench-close" }],
  deadlift: [{ phrase: ["sumo"], kind: "deadlift-sumo" }, { phrase: ["conventional"], kind: "deadlift-conventional" }],
};

/** What a name means when it says nothing more: "Squat" is drawn as a high bar squat, "Deadlift" as conventional. */
const plain: Record<LiftFamily, LiftKind> = { squat: "squat-high", bench: "bench", deadlift: "deadlift-conventional" };

/** Words that belong to a lift's own name. */
const ownWords: Record<LiftFamily, readonly string[]> = { squat: [], bench: ["press", "presses", "flat"], deadlift: [] };

/** Words that say how a set is done without changing what the lift looks like. Anything else in a name stops the drawing. */
const samePicture = new Set([
  "barbell", "bb", "back", "off", "backoff", "comp", "competition", "paused", "pause", "tempo", "touch", "and", "go", "tng",
  "belted", "beltless", "raw", "heavy", "light", "volume", "top", "set", "sets", "single", "singles", "double", "doubles",
  "triple", "triples", "ct", "count", "sec", "second", "seconds", "amrap",
]);
/** Counts and tempos: 3, 2ct, 3s, 5x5. */
const figure = /^\d+(?:ct|s|sec|x\d+)?$/;
/** A fraction or a decimal ("1 1/2 squat", "squat 1.5", "1½"): a different movement, which a count or a tempo is not. */
const fractional = /\d\s*\/\s*\d|\d\.\d|[\u00bc-\u00be\u2150-\u215f]/;

/** Remove every run of `phrase` from `words`; say whether there was one. */
function take(words: string[], phrase: readonly string[]): boolean {
  let found = false;
  for (let at = 0; at + phrase.length <= words.length;) {
    if (phrase.every((word, offset) => words[at + offset] === word)) {
      words.splice(at, phrase.length);
      found = true;
    } else {
      at += 1;
    }
  }
  return found;
}

/**
 * Which of the six lifts an exercise is, or null when it is none of them or the
 * name leaves any doubt. Only barbell exercises are lifts.
 */
export function liftKind(exercise: { name: string; equipment: Equipment }): LiftKind | null {
  if (exercise.equipment !== "barbell" || fractional.test(exercise.name)) return null;
  const words = exercise.name.toLowerCase().replace(/\bt\s*&\s*g\b/g, "tng")
    .split(/[^a-z0-9]+/).filter(Boolean).flatMap((word) => shorthand[word] ?? [word]);

  const families = new Set(words.flatMap((word) => (word in familyWords ? [familyWords[word]] : [])));
  if (families.size !== 1) return null;
  const [family] = families;
  const rest = words.filter((word) => !(word in familyWords));

  const named = new Set<LiftKind>();
  for (const { phrase, kind } of variants[family]) {
    if (take(rest, phrase)) named.add(kind);
  }
  if (named.size > 1) return null;

  const own = ownWords[family];
  if (!rest.every((word) => own.includes(word) || samePicture.has(word) || figure.test(word))) return null;
  return named.size === 1 ? [...named][0] : plain[family];
}

// The lifts of a week ---------------------------------------------------------

/** A set longer than this is not drawn in motion: nobody watches it, and it is not how these lifts are trained. */
export const MAX_DRAWN_REPS = 30;

type LiftBlock = {
  exercise: { name: string; equipment: Equipment; barKg: number | null };
  /** The heaviest working set of the block. */
  top: Measures | null;
};

export type TopLift<Session, Block> = { kind: LiftKind; session: Session; block: Block; load: number; reps: number };

/**
 * The heaviest working set of each of the six lifts among these sessions, heaviest
 * first; equal loads by reps, then squat before bench before deadlift. A set is only
 * listed when it can be drawn truthfully: a load the plates can make, and reps to count.
 */
export function topLifts<Block extends LiftBlock, Session extends { blocks: readonly Block[] }>(
  sessions: readonly Session[],
): Array<TopLift<Session, Block>> {
  const best = new Map<LiftKind, TopLift<Session, Block>>();
  for (const session of sessions) {
    for (const block of session.blocks) {
      const kind = liftKind(block.exercise);
      const load = block.top?.load ?? null;
      const reps = block.top?.reps ?? null;
      if (kind === null || load === null || reps === null || reps < 1 || reps > MAX_DRAWN_REPS) continue;
      if (platesPerSide(load, block.exercise.barKg ?? STANDARD_BAR_KG) === null) continue;
      const held = best.get(kind);
      if (!held || load > held.load || (load === held.load && reps > held.reps)) best.set(kind, { kind, session, block, load, reps });
    }
  }
  return [...best.values()].sort((a, b) =>
    b.load - a.load || b.reps - a.reps || LIFT_KINDS.indexOf(a.kind) - LIFT_KINDS.indexOf(b.kind));
}
