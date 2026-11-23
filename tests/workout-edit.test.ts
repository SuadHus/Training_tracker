import assert from "node:assert/strict";
import test from "node:test";
import {
  emptySet, limits, noMeasures, type BlockDoc, type ExerciseInfo, type Measures, type SetDoc, type SetTarget, type WorkoutDoc,
} from "../src/lib/workout-doc";
import {
  draftOf, editWorkout, placeholderFor, previousFor, restFor, sameDraft, starterSets, type ExerciseHistory,
} from "../src/lib/workout-edit";

const m = (overrides: Partial<Measures>): Measures => ({ ...noMeasures, ...overrides });

function set(id: string, overrides: Omit<Partial<SetDoc>, "target"> & { target?: Partial<SetTarget> } = {}): SetDoc {
  const { target, ...rest } = overrides;
  return emptySet({ id, ...rest, target: { ...noMeasures, repsMax: null, ...target } });
}

const block = (id: string, sets: SetDoc[], exerciseId = "ex1"): BlockDoc => ({ id, exerciseId, notes: "", restSeconds: null, sets });

function workout(blocks: BlockDoc[], status: WorkoutDoc["status"] = "planned"): WorkoutDoc {
  return {
    id: "w", status, title: "Legs", day: status === "template" ? null : "2026-11-22", notes: "", templateId: null,
    startedAt: null, completedAt: null, revision: 3, blocks,
  };
}

const base = () => workout([
  block("a", [set("a1", { target: { reps: 5, load: 100 } }), set("a2", { target: { reps: 5, load: 100 } })]),
  block("b", [set("b1")], "ex2"),
]);

const exercise = (overrides: Partial<ExerciseInfo> = {}): ExerciseInfo => ({
  id: "ex1", name: "Squat", tracking: "weight_reps", equipment: "barbell", barKg: null, restSeconds: null,
  primaryMuscle: "Quads", secondaryMuscles: [], notes: "", archived: false, ...overrides,
});

test("renaming, redating and noting change the document and nothing else", () => {
  const doc = base();
  assert.equal(editWorkout(doc, { type: "rename", title: "Push" }).title, "Push");
  assert.equal(editWorkout(doc, { type: "setDay", day: "2026-11-23" }).day, "2026-11-23");
  assert.equal(editWorkout(doc, { type: "setNotes", notes: "x" }).notes, "x");
  assert.equal(editWorkout(doc, { type: "rename", title: "Legs" }), doc);
  assert.equal(editWorkout(doc, { type: "rename", title: "Push" }).blocks, doc.blocks);
});

test("blocks are added at an index, removed and moved with clamping", () => {
  const doc = base();
  const added = editWorkout(doc, { type: "addBlock", block: block("c", []), at: 1 });
  assert.deepEqual(added.blocks.map((b) => b.id), ["a", "c", "b"]);
  assert.deepEqual(editWorkout(doc, { type: "addBlock", block: block("c", []) }).blocks.map((b) => b.id), ["a", "b", "c"]);
  assert.deepEqual(editWorkout(doc, { type: "addBlock", block: block("c", []), at: 99 }).blocks.map((b) => b.id), ["a", "b", "c"]);
  assert.equal(editWorkout(doc, { type: "addBlock", block: block("a", []) }), doc);
  assert.deepEqual(editWorkout(added, { type: "removeBlock", blockId: "c" }).blocks.map((b) => b.id), ["a", "b"]);
  assert.equal(editWorkout(doc, { type: "removeBlock", blockId: "zzz" }), doc);
  assert.deepEqual(editWorkout(doc, { type: "moveBlock", blockId: "a", to: 1 }).blocks.map((b) => b.id), ["b", "a"]);
  assert.deepEqual(editWorkout(doc, { type: "moveBlock", blockId: "b", to: -4 }).blocks.map((b) => b.id), ["b", "a"]);
  assert.deepEqual(editWorkout(doc, { type: "moveBlock", blockId: "a", to: 99 }).blocks.map((b) => b.id), ["b", "a"]);
  assert.equal(editWorkout(doc, { type: "moveBlock", blockId: "a", to: 0 }), doc);
  assert.equal(editWorkout(doc, { type: "moveBlock", blockId: "zzz", to: 0 }), doc);
});

test("replacing the exercise keeps the sets and clears custom values", () => {
  const doc = workout([block("a", [set("a1", { custom: { f: 3 }, actual: m({ reps: 5 }) }), set("a2")])]);
  const next = editWorkout(doc, { type: "replaceExercise", blockId: "a", exerciseId: "ex9" });
  assert.equal(next.blocks[0].exerciseId, "ex9");
  assert.deepEqual(next.blocks[0].sets.map((s) => s.id), ["a1", "a2"]);
  assert.deepEqual(next.blocks[0].sets[0].custom, {});
  assert.equal(next.blocks[0].sets[0].actual.reps, 5);
  assert.equal(next.blocks[0].sets[1], doc.blocks[0].sets[1]);
  assert.equal(editWorkout(doc, { type: "replaceExercise", blockId: "a", exerciseId: "ex1" }), doc);
});

test("replacing the exercise unlogs a set whose only result was a custom value", () => {
  const stamped = set("a1", { custom: { f: 5 }, loggedAt: "2026-11-22T09:00:00.000Z" });
  const kept = set("a2", { custom: { f: 5 }, actual: m({ reps: 5 }), loggedAt: "2026-11-22T09:05:00.000Z" });
  const next = editWorkout(workout([block("a", [stamped, kept])]), { type: "replaceExercise", blockId: "a", exerciseId: "ex9" });
  assert.equal(next.blocks[0].sets[0].loggedAt, null);
  assert.deepEqual(next.blocks[0].sets[0].custom, {});
  assert.equal(next.blocks[0].sets[1].loggedAt, "2026-11-22T09:05:00.000Z");
});

test("replacing with an exercise that records something else clears the numbers and the ticks", () => {
  const done = set("a1", { target: { ...m({ reps: 5, load: 140 }), repsMax: null }, actual: m({ reps: 5, load: 140 }), loggedAt: "2026-11-22T09:00:00.000Z" });
  const warm = set("a2", { warmup: true, actual: m({ reps: 3 }) });
  const next = editWorkout(workout([block("a", [done, warm])]), { type: "replaceExercise", blockId: "a", exerciseId: "ex9", clear: true });
  assert.equal(next.blocks[0].exerciseId, "ex9");
  assert.deepEqual(next.blocks[0].sets.map((s) => [s.id, s.warmup, s.loggedAt, s.actual.reps, s.actual.load, s.target.reps, s.target.load]), [
    ["a1", false, null, null, null, null, null], ["a2", true, null, null, null, null, null],
  ]);
});

test("an exercise takes no more sets, and a workout no more exercises, than the server accepts", () => {
  const full = workout([block("a", Array.from({ length: limits.setsPerBlock }, (_, at) => set(`s${at}`)))]);
  assert.equal(editWorkout(full, { type: "addSet", blockId: "a", setId: "more" }), full);
  assert.equal(editWorkout(full, { type: "addSet", blockId: "a", setId: "warm", warmup: true }), full);
  const crowded = workout(Array.from({ length: limits.blocks }, (_, at) => block(`b${at}`, [])));
  assert.equal(editWorkout(crowded, { type: "addBlock", block: block("one-more", []) }), crowded);
});

test("block notes and rest are edited", () => {
  const doc = base();
  assert.equal(editWorkout(doc, { type: "setBlockNotes", blockId: "a", notes: "slow" }).blocks[0].notes, "slow");
  assert.equal(editWorkout(doc, { type: "setBlockRest", blockId: "a", restSeconds: 120 }).blocks[0].restSeconds, 120);
  assert.equal(editWorkout(doc, { type: "setBlockRest", blockId: "a", restSeconds: null }), doc);
});

test("a working set is appended with the target of the last working set", () => {
  const doc = workout([block("a", [set("w0", { warmup: true, target: { load: 40 } }), set("w1", { target: { reps: 5, load: 100 } })])]);
  const next = editWorkout(doc, { type: "addSet", blockId: "a", setId: "n" });
  const added = next.blocks[0].sets[2];
  assert.equal(added.id, "n");
  assert.equal(added.warmup, false);
  assert.equal(added.target.load, 100);
  assert.deepEqual(added.actual, noMeasures);
  assert.deepEqual(added.custom, {});
  assert.equal(added.loggedAt, null);
  assert.notEqual(added.target, next.blocks[0].sets[1].target);
});

test("a warm-up goes after the last warm-up, or at the top, and copies the last warm-up target", () => {
  const doc = workout([block("a", [set("w0", { warmup: true, target: { load: 40 } }), set("w1", { target: { load: 100 } })])]);
  const next = editWorkout(doc, { type: "addSet", blockId: "a", setId: "n", warmup: true });
  assert.deepEqual(next.blocks[0].sets.map((s) => s.id), ["w0", "n", "w1"]);
  assert.equal(next.blocks[0].sets[1].target.load, 40);
  const noWarmups = workout([block("a", [set("w1", { target: { load: 100 } })])]);
  const top = editWorkout(noWarmups, { type: "addSet", blockId: "a", setId: "n", warmup: true });
  assert.deepEqual(top.blocks[0].sets.map((s) => s.id), ["n", "w1"]);
  assert.equal(top.blocks[0].sets[0].target.load, 100);
});

test("a set added to an empty block has an empty target, and unknown ids change nothing", () => {
  const doc = workout([block("a", [])]);
  const next = editWorkout(doc, { type: "addSet", blockId: "a", setId: "n" });
  assert.deepEqual(next.blocks[0].sets[0].target, { ...noMeasures, repsMax: null });
  assert.equal(editWorkout(doc, { type: "addSet", blockId: "zzz", setId: "n" }), doc);
  assert.equal(editWorkout(next, { type: "addSet", blockId: "a", setId: "n" }), next);
});

test("sets are removed and the warm-up flag flips without re-sorting", () => {
  const doc = base();
  assert.deepEqual(editWorkout(doc, { type: "removeSet", blockId: "a", setId: "a1" }).blocks[0].sets.map((s) => s.id), ["a2"]);
  assert.equal(editWorkout(doc, { type: "removeSet", blockId: "a", setId: "zzz" }), doc);
  const flipped = editWorkout(doc, { type: "setWarmup", blockId: "a", setId: "a2", warmup: true });
  assert.deepEqual(flipped.blocks[0].sets.map((s) => [s.id, s.warmup]), [["a1", false], ["a2", true]]);
  assert.equal(editWorkout(doc, { type: "setWarmup", blockId: "a", setId: "a2", warmup: false }), doc);
});

test("targets are patched, including in a template", () => {
  const doc = workout([block("a", [set("a1")])], "template");
  const next = editWorkout(doc, { type: "editTarget", blockId: "a", setId: "a1", patch: { reps: 8, repsMax: 12 } });
  assert.equal(next.blocks[0].sets[0].target.reps, 8);
  assert.equal(next.blocks[0].sets[0].target.repsMax, 12);
  assert.equal(editWorkout(next, { type: "editTarget", blockId: "a", setId: "a1", patch: { reps: 8 } }), next);
  assert.equal(editWorkout(next, { type: "editTarget", blockId: "a", setId: "a1", patch: { reps: null } }).blocks[0].sets[0].target.reps, null);
});

test("actual values are patched and a logged set stays logged while it has a result", () => {
  const doc = workout([block("a", [set("a1", { actual: m({ reps: 5, load: 100 }), loggedAt: "2026-11-22T09:00:00Z" })])]);
  const next = editWorkout(doc, { type: "editActual", blockId: "a", setId: "a1", patch: { reps: 6 } });
  assert.equal(next.blocks[0].sets[0].actual.reps, 6);
  assert.equal(next.blocks[0].sets[0].loggedAt, "2026-11-22T09:00:00Z");
  assert.equal(editWorkout(next, { type: "editActual", blockId: "a", setId: "a1", patch: { reps: 6 } }), next);
});

test("clearing the last result of a logged set takes it out of the log", () => {
  const doc = workout([block("a", [set("a1", { actual: m({ reps: 5, load: 100 }), loggedAt: "2026-11-22T09:00:00Z" })])]);
  const next = editWorkout(doc, { type: "editActual", blockId: "a", setId: "a1", patch: { reps: null } });
  assert.equal(next.blocks[0].sets[0].loggedAt, null);
  assert.equal(next.blocks[0].sets[0].actual.load, 100);
});

test("custom values are set, replaced and cleared, and count as a result", () => {
  const doc = workout([block("a", [set("a1", { actual: m({ reps: 5 }), loggedAt: "2026-11-22T09:00:00Z" })])]);
  const withField = editWorkout(doc, { type: "editCustom", blockId: "a", setId: "a1", fieldId: "f", value: 3 });
  assert.deepEqual(withField.blocks[0].sets[0].custom, { f: 3 });
  assert.equal(editWorkout(withField, { type: "editCustom", blockId: "a", setId: "a1", fieldId: "f", value: 3 }), withField);
  const cleared = editWorkout(withField, { type: "editCustom", blockId: "a", setId: "a1", fieldId: "f", value: null });
  assert.deepEqual(cleared.blocks[0].sets[0].custom, {});
  assert.equal(editWorkout(cleared, { type: "editCustom", blockId: "a", setId: "a1", fieldId: "f", value: "" }), cleared);
  const onlyCustom = workout([block("a", [set("a1", { custom: { f: 3 }, loggedAt: "2026-11-22T09:00:00Z" })])]);
  const gone = editWorkout(onlyCustom, { type: "editCustom", blockId: "a", setId: "a1", fieldId: "f", value: null });
  assert.equal(gone.blocks[0].sets[0].loggedAt, null);
});

test("logging fills missing values from the fallback but never the RPE", () => {
  const doc = workout([block("a", [set("a1", { actual: m({ reps: 4 }) })])]);
  const fallback = m({ reps: 5, load: 100, rpe: 9, duration: 30, distance: 10 });
  const set1 = editWorkout(doc, { type: "logSet", blockId: "a", setId: "a1", at: "2026-11-22T09:00:00Z", fallback }).blocks[0].sets[0];
  assert.deepEqual(set1.actual, m({ reps: 4, load: 100, duration: 30, distance: 10 }));
  assert.equal(set1.loggedAt, "2026-11-22T09:00:00Z");
});

test("logging with nothing to record changes nothing, and logging twice keeps the first time", () => {
  const doc = workout([block("a", [set("a1")])]);
  assert.equal(editWorkout(doc, { type: "logSet", blockId: "a", setId: "a1", at: "t", fallback: m({ load: 100, rpe: 8 }) }), doc);
  const once = editWorkout(doc, { type: "logSet", blockId: "a", setId: "a1", at: "t1", fallback: m({ reps: 5 }) });
  assert.equal(editWorkout(once, { type: "logSet", blockId: "a", setId: "a1", at: "t2", fallback: m({ reps: 5 }) }), once);
});

test("unlogging keeps the values as a draft", () => {
  const doc = workout([block("a", [set("a1", { actual: m({ reps: 5, load: 100 }), loggedAt: "t" })])]);
  const next = editWorkout(doc, { type: "unlogSet", blockId: "a", setId: "a1" });
  assert.equal(next.blocks[0].sets[0].loggedAt, null);
  assert.equal(next.blocks[0].sets[0].actual.reps, 5);
  assert.equal(editWorkout(next, { type: "unlogSet", blockId: "a", setId: "a1" }), next);
});

test("logging, unlogging and actual edits do nothing in a template", () => {
  const doc = workout([block("a", [set("a1", { actual: m({ reps: 5 }) })])], "template");
  const fallback = m({ reps: 5 });
  assert.equal(editWorkout(doc, { type: "logSet", blockId: "a", setId: "a1", at: "t", fallback }), doc);
  assert.equal(editWorkout(doc, { type: "unlogSet", blockId: "a", setId: "a1" }), doc);
  assert.equal(editWorkout(doc, { type: "editActual", blockId: "a", setId: "a1", patch: { reps: 9 } }), doc);
  assert.equal(editWorkout(doc, { type: "editCustom", blockId: "a", setId: "a1", fieldId: "f", value: 1 }), doc);
});

test("replace swaps in a whole document", () => {
  const other = workout([]);
  assert.equal(editWorkout(base(), { type: "replace", doc: other }), other);
});

const history: ExerciseHistory = {
  day: "2026-11-15", workoutId: "old",
  sets: [
    { warmup: true, measures: m({ reps: 5, load: 40 }) },
    { warmup: true, measures: m({ reps: 3, load: 70 }) },
    { warmup: false, measures: m({ reps: 5, load: 100 }) },
    { warmup: false, measures: m({ reps: 5, load: 105 }) },
  ],
};

test("last time lines up warm-ups with warm-ups and working sets with working sets", () => {
  const doc = block("a", [set("s0", { warmup: true }), set("s1", { warmup: true }), set("s2", { warmup: true }), set("s3"), set("s4"), set("s5")]);
  assert.equal(previousFor(history, doc, 0)?.measures.load, 40);
  assert.equal(previousFor(history, doc, 1)?.measures.load, 70);
  assert.equal(previousFor(history, doc, 2), null);
  assert.equal(previousFor(history, doc, 3)?.measures.load, 100);
  assert.equal(previousFor(history, doc, 4)?.measures.load, 105);
  assert.equal(previousFor(history, doc, 5)?.measures.load, 105);
  assert.equal(previousFor(undefined, doc, 0), null);
  assert.equal(previousFor(history, doc, 99), null);
});

test("a placeholder prefers the target, then last time, per field", () => {
  const doc = block("a", [set("s0", { target: { reps: 8 } })]);
  assert.deepEqual(placeholderFor(doc, 0, history), m({ reps: 8, load: 100 }));
  assert.deepEqual(placeholderFor(doc, 0, undefined), m({ reps: 8 }));
});

test("a placeholder carries the load of an earlier logged set with the same target forward", () => {
  const doc = block("a", [
    set("s0", { target: { reps: 5, load: 100 }, actual: m({ reps: 5, load: 102.5 }), loggedAt: "t" }),
    set("s1", { target: { reps: 5, load: 100 } }),
    set("s2", { target: { reps: 5, load: 110 } }),
    set("s3", { warmup: true, target: { reps: 5, load: 100 } }),
  ]);
  assert.equal(placeholderFor(doc, 1, history).load, 102.5);
  assert.equal(placeholderFor(doc, 2, history).load, 110);
  assert.equal(placeholderFor(doc, 3, undefined).load, 100);
  const open = block("a", [set("s0", { actual: m({ reps: 5, load: 80 }), loggedAt: "t" }), set("s1")]);
  assert.equal(placeholderFor(open, 1, history).load, 80);
});

test("a placeholder never suggests an RPE", () => {
  const doc = block("a", [set("s0", { target: { rpe: 8 } })]);
  assert.equal(placeholderFor(doc, 0, { ...history, sets: [{ warmup: false, measures: m({ rpe: 9, reps: 5 }) }] }).rpe, null);
});

test("drafts compare by value, whatever the key order", () => {
  const doc = base();
  const draft = draftOf(doc);
  assert.deepEqual(Object.keys(draft), ["title", "day", "notes", "blocks"]);
  const clone = JSON.parse(JSON.stringify(draft));
  assert.equal(sameDraft(draft, clone), true);
  const reordered = { blocks: clone.blocks, notes: clone.notes, day: clone.day, title: clone.title };
  assert.equal(sameDraft(draft, reordered), true);
  assert.equal(sameDraft(draft, draftOf(editWorkout(doc, { type: "rename", title: "x" }))), false);
  const edited = editWorkout(doc, { type: "editTarget", blockId: "a", setId: "a1", patch: { reps: 6 } });
  assert.equal(sameDraft(draft, draftOf(edited)), false);
  const zero = editWorkout(doc, { type: "editTarget", blockId: "a", setId: "a1", patch: { load: 0 } });
  const negative = editWorkout(doc, { type: "editTarget", blockId: "a", setId: "a1", patch: { load: -0 } });
  assert.equal(sameDraft(draftOf(zero), draftOf(negative)), true);
});

test("starter sets copy the shape of last time without numbers", () => {
  const sets = starterSets(exercise(), history, false);
  assert.deepEqual(sets.map((s) => s.warmup), [true, true, false, false]);
  for (const s of sets) {
    assert.deepEqual(s.actual, noMeasures);
    assert.equal(s.target.load, null);
    assert.equal(s.loggedAt, null);
  }
  assert.equal(new Set(sets.map((s) => s.id)).size, 4);
});

test("starter sets without history are three working sets, one for timed work", () => {
  assert.equal(starterSets(exercise(), undefined, false).length, 3);
  assert.equal(starterSets(exercise({ tracking: "duration" }), undefined, false).length, 1);
  assert.equal(starterSets(exercise({ tracking: "distance_duration" }), undefined, false).length, 1);
  assert.equal(starterSets(exercise(), history, true).length, 3);
  assert.equal(starterSets(exercise({ tracking: "duration" }), history, true).length, 1);
  assert.ok(starterSets(exercise(), undefined, false).every((s) => !s.warmup));
});

test("rest falls back from the block to the exercise to the default", () => {
  const plain = block("a", []);
  assert.equal(restFor({ ...plain, restSeconds: 60 }, exercise({ restSeconds: 90 })), 60);
  assert.equal(restFor(plain, exercise({ restSeconds: 90 })), 90);
  assert.equal(restFor(plain, exercise()), 150);
  assert.equal(restFor(plain, undefined), 150);
  assert.equal(restFor({ ...plain, restSeconds: 0 }, exercise({ restSeconds: 90 })), 0);
});
