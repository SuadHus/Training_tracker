// The editor's state transitions. Every function is pure: no clock, no randomness, no IO.
import {
  DEFAULT_REST_SECONDS, emptySet, hasResult, isLogged, noMeasures,
  type BlockDoc, type ExerciseInfo, type Measures, type SetDoc, type SetTarget, type WorkoutDoc, type WorkoutDraft,
} from "./workout-doc";

export type HistorySet = { warmup: boolean; measures: Measures };
/** The most recent completed session that logged an exercise. */
export type ExerciseHistory = { day: string; workoutId: string; sets: HistorySet[] };

export type EditAction =
  | { type: "rename"; title: string }
  | { type: "setDay"; day: string }
  | { type: "setNotes"; notes: string }
  | { type: "addBlock"; block: BlockDoc; at?: number }
  | { type: "removeBlock"; blockId: string }
  | { type: "moveBlock"; blockId: string; to: number }
  | { type: "replaceExercise"; blockId: string; exerciseId: string }
  | { type: "setBlockNotes"; blockId: string; notes: string }
  | { type: "setBlockRest"; blockId: string; restSeconds: number | null }
  | { type: "addSet"; blockId: string; setId: string; warmup?: boolean }
  | { type: "removeSet"; blockId: string; setId: string }
  | { type: "setWarmup"; blockId: string; setId: string; warmup: boolean }
  | { type: "editTarget"; blockId: string; setId: string; patch: Partial<SetTarget> }
  | { type: "editActual"; blockId: string; setId: string; patch: Partial<Measures> }
  | { type: "editCustom"; blockId: string; setId: string; fieldId: string; value: string | number | null }
  | { type: "logSet"; blockId: string; setId: string; at: string; fallback: Measures }
  | { type: "unlogSet"; blockId: string; setId: string }
  | { type: "replace"; doc: WorkoutDoc };

function withBlocks(doc: WorkoutDoc, blocks: BlockDoc[]): WorkoutDoc {
  return { ...doc, blocks };
}

function updateBlock(doc: WorkoutDoc, blockId: string, change: (block: BlockDoc) => BlockDoc): WorkoutDoc {
  const index = doc.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return doc;
  const next = change(doc.blocks[index]);
  if (next === doc.blocks[index]) return doc;
  return withBlocks(doc, doc.blocks.map((block, at) => (at === index ? next : block)));
}

function updateSet(doc: WorkoutDoc, blockId: string, setId: string, change: (set: SetDoc) => SetDoc): WorkoutDoc {
  return updateBlock(doc, blockId, (block) => {
    const index = block.sets.findIndex((set) => set.id === setId);
    if (index === -1) return block;
    const next = change(block.sets[index]);
    if (next === block.sets[index]) return block;
    return { ...block, sets: block.sets.map((set, at) => (at === index ? next : set)) };
  });
}

function patched<T extends object>(value: T, patch: Partial<T>): T {
  let changed = false;
  const next = { ...value };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined || Object.is(patch[key], value[key])) continue;
    next[key] = patch[key] as T[keyof T];
    changed = true;
  }
  return changed ? next : value;
}

/** An edit that leaves a logged set with nothing countable takes it back out of the log. */
function settled(set: SetDoc): SetDoc {
  return isLogged(set) && !hasResult(set) ? { ...set, loggedAt: null } : set;
}

export function editWorkout(doc: WorkoutDoc, action: EditAction): WorkoutDoc {
  const template = doc.status === "template";
  switch (action.type) {
    case "replace":
      return action.doc;
    case "rename":
      return action.title === doc.title ? doc : { ...doc, title: action.title };
    case "setDay":
      return action.day === doc.day ? doc : { ...doc, day: action.day };
    case "setNotes":
      return action.notes === doc.notes ? doc : { ...doc, notes: action.notes };
    case "addBlock": {
      if (doc.blocks.some((block) => block.id === action.block.id)) return doc;
      const at = Math.min(Math.max(action.at ?? doc.blocks.length, 0), doc.blocks.length);
      return withBlocks(doc, [...doc.blocks.slice(0, at), action.block, ...doc.blocks.slice(at)]);
    }
    case "removeBlock":
      return doc.blocks.some((block) => block.id === action.blockId)
        ? withBlocks(doc, doc.blocks.filter((block) => block.id !== action.blockId))
        : doc;
    case "moveBlock": {
      const from = doc.blocks.findIndex((block) => block.id === action.blockId);
      if (from === -1) return doc;
      const rest = doc.blocks.filter((_, at) => at !== from);
      const to = Math.min(Math.max(action.to, 0), rest.length);
      if (to === from) return doc;
      return withBlocks(doc, [...rest.slice(0, to), doc.blocks[from], ...rest.slice(to)]);
    }
    case "replaceExercise":
      return updateBlock(doc, action.blockId, (block) => block.exerciseId === action.exerciseId ? block : {
        ...block,
        exerciseId: action.exerciseId,
        sets: block.sets.map((set) => (Object.keys(set.custom).length ? settled({ ...set, custom: {} }) : set)),
      });
    case "setBlockNotes":
      return updateBlock(doc, action.blockId, (block) => block.notes === action.notes ? block : { ...block, notes: action.notes });
    case "setBlockRest":
      return updateBlock(doc, action.blockId, (block) =>
        block.restSeconds === action.restSeconds ? block : { ...block, restSeconds: action.restSeconds });
    case "addSet":
      return updateBlock(doc, action.blockId, (block) => {
        if (block.sets.some((set) => set.id === action.setId)) return block;
        const warmup = action.warmup === true;
        const sameKind = block.sets.filter((set) => set.warmup === warmup);
        const model = sameKind.at(-1) ?? block.sets.at(-1);
        const added = emptySet({
          id: action.setId,
          warmup,
          ...(model ? { target: { ...model.target } } : {}),
        });
        if (!warmup) return { ...block, sets: [...block.sets, added] };
        let at = 0;
        block.sets.forEach((set, index) => {
          if (set.warmup) at = index + 1;
        });
        return { ...block, sets: [...block.sets.slice(0, at), added, ...block.sets.slice(at)] };
      });
    case "removeSet":
      return updateBlock(doc, action.blockId, (block) =>
        block.sets.some((set) => set.id === action.setId)
          ? { ...block, sets: block.sets.filter((set) => set.id !== action.setId) }
          : block);
    case "setWarmup":
      return updateSet(doc, action.blockId, action.setId, (set) =>
        set.warmup === action.warmup ? set : { ...set, warmup: action.warmup });
    case "editTarget":
      return updateSet(doc, action.blockId, action.setId, (set) => {
        const target = patched(set.target, action.patch);
        return target === set.target ? set : { ...set, target };
      });
    case "editActual":
      if (template) return doc;
      return updateSet(doc, action.blockId, action.setId, (set) => {
        const actual = patched(set.actual, action.patch);
        return actual === set.actual ? set : settled({ ...set, actual });
      });
    case "editCustom":
      if (template) return doc;
      return updateSet(doc, action.blockId, action.setId, (set) => {
        const empty = action.value === null || action.value === "";
        if (empty ? !(action.fieldId in set.custom) : set.custom[action.fieldId] === action.value) return set;
        const custom = { ...set.custom };
        if (empty) delete custom[action.fieldId];
        else custom[action.fieldId] = action.value!;
        return settled({ ...set, custom });
      });
    case "logSet":
      if (template) return doc;
      return updateSet(doc, action.blockId, action.setId, (set) => {
        if (isLogged(set)) return set;
        const { fallback } = action;
        const actual: Measures = {
          reps: set.actual.reps ?? fallback.reps,
          load: set.actual.load ?? fallback.load,
          rpe: set.actual.rpe,
          duration: set.actual.duration ?? fallback.duration,
          distance: set.actual.distance ?? fallback.distance,
        };
        const next = { ...set, actual };
        return hasResult(next) ? { ...next, loggedAt: action.at } : set;
      });
    case "unlogSet":
      if (template) return doc;
      return updateSet(doc, action.blockId, action.setId, (set) => (isLogged(set) ? { ...set, loggedAt: null } : set));
  }
}

function nth(sets: HistorySet[], warmup: boolean, n: number): HistorySet | null {
  return sets.filter((set) => set.warmup === warmup)[n] ?? null;
}

/** The set from last time that lines up with block.sets[index], counting warm-ups and working sets separately. */
export function previousFor(history: ExerciseHistory | undefined, block: BlockDoc, index: number): HistorySet | null {
  const set = block.sets[index];
  if (!history || !set) return null;
  const n = block.sets.slice(0, index).filter((other) => other.warmup === set.warmup).length;
  const match = nth(history.sets, set.warmup, n);
  if (match || set.warmup) return match;
  return history.sets.filter((other) => !other.warmup).at(-1) ?? null;
}

/** What the logger shows greyed in an unlogged set, and what logging it with no typing records. */
export function placeholderFor(block: BlockDoc, index: number, history: ExerciseHistory | undefined): Measures {
  const set = block.sets[index];
  if (!set) return { ...noMeasures };
  const previous = previousFor(history, block, index)?.measures ?? noMeasures;
  let carried: number | null = null;
  for (let at = index - 1; at >= 0 && carried === null; at -= 1) {
    const earlier = block.sets[at];
    if (isLogged(earlier) && earlier.warmup === set.warmup && earlier.target.load === set.target.load) {
      carried = earlier.actual.load;
    }
  }
  return {
    reps: set.target.reps ?? previous.reps,
    load: carried ?? set.target.load ?? previous.load,
    rpe: null,
    duration: set.target.duration ?? previous.duration,
    distance: set.target.distance ?? previous.distance,
  };
}

export function draftOf(doc: WorkoutDoc): WorkoutDraft {
  return { title: doc.title, day: doc.day, notes: doc.notes, blocks: doc.blocks };
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => equal(item, other[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && equal(left[key], right[key]));
}

export function sameDraft(a: WorkoutDraft, b: WorkoutDraft): boolean {
  return equal(a, b);
}

const timed = (exercise: ExerciseInfo) => exercise.tracking === "duration" || exercise.tracking === "distance_duration";

/** Sets for a block that was just added. Numbers come from the previous column and placeholders, not from the sets. */
export function starterSets(exercise: ExerciseInfo, history: ExerciseHistory | undefined, template: boolean): SetDoc[] {
  if (!template && history && history.sets.length) return history.sets.map(({ warmup }) => emptySet({ warmup }));
  return Array.from({ length: timed(exercise) ? 1 : 3 }, () => emptySet());
}

export function restFor(block: BlockDoc, exercise: ExerciseInfo | undefined): number {
  return block.restSeconds ?? exercise?.restSeconds ?? DEFAULT_REST_SECONDS;
}
