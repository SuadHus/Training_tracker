import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  WorkoutInputError, addDays, emptySet, isoWeek, noMeasures, stockholmDay, weekStart,
  type ExerciseInfo, type SetDoc, type SetTarget, type WorkoutDoc,
} from "../src/lib/workout-doc";
import { databaseUrl, isolatedSchema, schemaSql } from "./isolated-schema";

const skip = !databaseUrl;
type Store = typeof import("../src/lib/workout-store");
type Pub = typeof import("../src/lib/public-data");

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: Store;
let pub: Pub;
let squat: ExerciseInfo;
let press: ExerciseInfo;
let row: ExerciseInfo;
let plank: ExerciseInfo;

const today = stockholmDay();
const thisMonday = weekStart(today);

before(async () => {
  if (skip) return;
  schema = await isolatedSchema(databaseUrl!);
  await schema.run(schemaSql);
  process.env.DATABASE_URL = schema.url;
  store = await import("../src/lib/workout-store");
  pub = await import("../src/lib/public-data");
  squat = await store.saveExercise({ name: "Squat", tracking: "weight_reps", equipment: "barbell", primaryMuscle: "Quads" });
  press = await store.saveExercise({ name: "Press", tracking: "weight_reps", equipment: "barbell", primaryMuscle: "Shoulders" });
  row = await store.saveExercise({ name: "Row", tracking: "weight_reps", equipment: "cable", primaryMuscle: "Back" });
  plank = await store.saveExercise({ name: "Plank", tracking: "duration", equipment: "other", primaryMuscle: "Core" });
});

after(async () => {
  if (skip) return;
  await (globalThis as { trainingPool?: { end(): Promise<void> } }).trainingPool?.end();
  await schema.drop();
});

type SetSpec = {
  reps?: number | null; load?: number | null; rpe?: number | null; duration?: number | null; warmup?: boolean;
  done?: boolean; target?: Partial<SetTarget>; custom?: Record<string, string | number>; at?: string;
};
type BlockSpec = { exercise: ExerciseInfo; sets: SetSpec[]; notes?: string; rest?: number | null };

function setDoc(spec: SetSpec): SetDoc {
  return emptySet({
    warmup: spec.warmup ?? false,
    target: { ...noMeasures, repsMax: null, ...spec.target },
    actual: { ...noMeasures, reps: spec.reps ?? null, load: spec.load ?? null, rpe: spec.rpe ?? null, duration: spec.duration ?? null },
    custom: spec.custom ?? {},
    loggedAt: spec.done ? spec.at ?? new Date(Date.now() - 3_600_000).toISOString() : null,
  });
}

const draftOf = (title: string, day: string | null, blocks: BlockSpec[]) => ({
  title, day, notes: "",
  blocks: blocks.map((block) => ({
    id: crypto.randomUUID(), exerciseId: block.exercise.id, notes: block.notes ?? "", restSeconds: block.rest ?? null,
    sets: block.sets.map(setDoc),
  })),
});

async function reset() {
  await schema.rows("DELETE FROM workouts");
  await schema.rows("DELETE FROM field_definitions");
}

async function planned(day: string, blocks: BlockSpec[], title = "Session") {
  const id = await store.createWorkout({ status: "planned", day, title });
  const saved = await store.saveWorkout(id, 0, draftOf(title, day, blocks));
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return id;
}

async function completed(day: string, blocks: BlockSpec[], title = "Session") {
  const id = await planned(day, blocks, title);
  await store.completeWorkout(id);
  return id;
}

const lifted = (reps: number, load: number, extra: SetSpec = {}): SetSpec => ({ reps, load, done: true, ...extra });

test("saving and loading keeps order, targets, actuals and custom values", { skip }, async () => {
  await reset();
  const field = await store.saveField({ label: "Tempo", kind: "text" });
  const id = await store.createWorkout({ status: "planned", day: today, title: "Legs" });
  const draft = draftOf("Legs", today, [
    {
      exercise: squat, notes: "slow down", rest: 180,
      sets: [
        { warmup: true, target: { reps: 5, load: 60 }, reps: 5, load: 60, done: true },
        { target: { reps: 5, repsMax: 8, load: 100, rpe: 8 }, reps: 6, load: 100, rpe: 8, done: true, custom: { [field.id]: "3-1-1" } },
        { target: { reps: 5, load: 100 }, reps: 4, load: 100 },
      ],
    },
    { exercise: plank, sets: [{ target: { duration: 60 }, duration: 62, done: true }] },
  ]);
  const saved = await store.saveWorkout(id, 0, draft);
  assert.deepEqual(saved.ok && saved.revision, 1);
  assert.ok(saved.ok && saved.startedAt);

  const doc = (await store.loadWorkout(id))!;
  assert.equal(doc.revision, 1);
  assert.equal(doc.status, "planned");
  assert.equal(doc.day, today);
  assert.ok(doc.startedAt);
  assert.deepEqual(doc.blocks.map((block) => block.exerciseId), [squat.id, plank.id]);
  assert.deepEqual(doc.blocks[0], draft.blocks[0]);
  assert.deepEqual(doc.blocks[1], draft.blocks[1]);

  const positions = await schema.rows<{ block: number; set: number }>(
    `SELECT b.position AS block, s.position AS set FROM workout_sets s JOIN workout_exercises b ON b.id = s.workout_exercise_id
      WHERE s.workout_id = $1 ORDER BY s.position`, [id],
  );
  assert.deepEqual(positions.map((p) => p.set), [1, 2, 3, 4]);
  assert.deepEqual(positions.map((p) => p.block), [0, 0, 0, 1]);
});

test("each save bumps the revision and a stale revision gets the current document back", { skip }, async () => {
  await reset();
  const id = await store.createWorkout({ status: "planned", day: today, title: "Legs" });
  const first = await store.saveWorkout(id, 0, draftOf("Legs", today, [{ exercise: squat, sets: [{}] }]));
  assert.ok(first.ok && first.revision === 1);
  const second = await store.saveWorkout(id, 1, draftOf("Legs 2", today, []));
  assert.ok(second.ok && second.revision === 2);
  const stale = await store.saveWorkout(id, 1, draftOf("Overwrite", today, []));
  assert.equal(stale.ok, false);
  assert.ok(!stale.ok && stale.reason === "conflict" && stale.current.revision === 2 && stale.current.title === "Legs 2");
  assert.equal((await store.loadWorkout(id))!.title, "Legs 2");
});

test("a missing workout and an unreadable draft are reported, and nothing is written", { skip }, async () => {
  await reset();
  const gone = await store.saveWorkout(crypto.randomUUID(), 0, draftOf("x", today, []));
  assert.deepEqual(gone, { ok: false, reason: "missing" });
  const id = await planned(today, [{ exercise: squat, sets: [lifted(5, 100)] }], "Keep");
  const before = await store.loadWorkout(id);
  const bad = await store.saveWorkout(id, 1, { title: "", day: today, notes: "", blocks: [] });
  assert.ok(!bad.ok && bad.reason === "invalid" && /name/i.test(bad.message));
  const worse = await store.saveWorkout(id, 1, "nonsense");
  assert.ok(!worse.ok && worse.reason === "invalid");
  assert.deepEqual(await store.loadWorkout(id), before);
});

test("ids that belong to another workout are rejected and leave both workouts alone", { skip }, async () => {
  await reset();
  const a = await planned(today, [{ exercise: squat, sets: [lifted(5, 100)] }], "A");
  const b = await planned(today, [{ exercise: press, sets: [lifted(5, 40)] }], "B");
  const docA = (await store.loadWorkout(a))!;
  const docB = (await store.loadWorkout(b))!;

  const stealBlock = { title: "B", day: today, notes: "", blocks: [{ ...docA.blocks[0], sets: [] }] };
  const first = await store.saveWorkout(b, docB.revision, stealBlock);
  assert.ok(!first.ok && first.reason === "invalid");

  const stealSet = { title: "B", day: today, notes: "", blocks: [{ ...docB.blocks[0], sets: [docA.blocks[0].sets[0]] }] };
  const second = await store.saveWorkout(b, docB.revision, stealSet);
  assert.ok(!second.ok && second.reason === "invalid");

  const ownBlockForeignSet = {
    title: "B", day: today, notes: "",
    blocks: [{ id: crypto.randomUUID(), exerciseId: press.id, notes: "", restSeconds: null, sets: [docA.blocks[0].sets[0]] }],
  };
  const third = await store.saveWorkout(b, docB.revision, ownBlockForeignSet);
  assert.ok(!third.ok && third.reason === "invalid");

  assert.deepEqual(await store.loadWorkout(a), docA);
  assert.deepEqual(await store.loadWorkout(b), docB);
});

test("removing a block removes its sets", { skip }, async () => {
  await reset();
  const id = await planned(today, [
    { exercise: squat, sets: [lifted(5, 100), lifted(5, 100)] },
    { exercise: press, sets: [lifted(5, 40)] },
  ]);
  const doc = (await store.loadWorkout(id))!;
  const kept = doc.blocks[1];
  const saved = await store.saveWorkout(id, doc.revision, { title: doc.title, day: doc.day, notes: "", blocks: [kept] });
  assert.equal(saved.ok, true);
  const [counts] = await schema.rows<{ blocks: number; sets: number }>(
    "SELECT (SELECT count(*) FROM workout_exercises)::int AS blocks, (SELECT count(*) FROM workout_sets)::int AS sets",
  );
  assert.deepEqual(counts, { blocks: 1, sets: 1 });
});

test("replacing the exercise of a block carries its sets along", { skip }, async () => {
  await reset();
  const id = await planned(today, [{ exercise: squat, sets: [lifted(5, 100), lifted(5, 100)] }]);
  const doc = (await store.loadWorkout(id))!;
  const swapped = { title: doc.title, day: doc.day, notes: "", blocks: [{ ...doc.blocks[0], exerciseId: press.id }] };
  assert.equal((await store.saveWorkout(id, doc.revision, swapped)).ok, true);
  const next = (await store.loadWorkout(id))!;
  assert.equal(next.blocks[0].exerciseId, press.id);
  assert.deepEqual(next.blocks[0].sets.map((set) => set.id), doc.blocks[0].sets.map((set) => set.id));
  const rows = await schema.rows<{ exercise_id: string }>("SELECT exercise_id FROM workout_sets");
  assert.ok(rows.every((entry) => entry.exercise_id === press.id));
});

test("sets can move between blocks of the same workout", { skip }, async () => {
  await reset();
  const id = await planned(today, [
    { exercise: squat, sets: [lifted(5, 100), lifted(5, 105)] },
    { exercise: squat, sets: [lifted(5, 110)] },
  ]);
  const doc = (await store.loadWorkout(id))!;
  const [first, second] = doc.blocks;
  const moved = { ...first, sets: [first.sets[0]] };
  const receiving = { ...second, sets: [first.sets[1], ...second.sets] };
  const saved = await store.saveWorkout(id, doc.revision, { title: doc.title, day: doc.day, notes: "", blocks: [moved, receiving] });
  assert.equal(saved.ok, true);
  const next = (await store.loadWorkout(id))!;
  assert.deepEqual(next.blocks.map((block) => block.sets.length), [1, 2]);
});

test("a template saves targets only", { skip }, async () => {
  await reset();
  const id = await store.createWorkout({ status: "template", title: "Push" });
  const draft = draftOf("Push", null, [{ exercise: press, sets: [lifted(5, 40, { target: { reps: 5, load: 40 } })] }]);
  assert.equal((await store.saveWorkout(id, 0, draft)).ok, true);
  const doc = (await store.loadWorkout(id))!;
  assert.equal(doc.status, "template");
  assert.equal(doc.day, null);
  assert.deepEqual(doc.blocks[0].sets[0].actual, noMeasures);
  assert.equal(doc.blocks[0].sets[0].loggedAt, null);
  assert.equal(doc.blocks[0].sets[0].target.load, 40);
});

test("starting from a template copies targets and not actuals, and a repeated id is a no-op", { skip }, async () => {
  await reset();
  const templateId = await store.createWorkout({ status: "template", title: "Push day" });
  const draft = draftOf("Push day", null, [
    { exercise: press, notes: "strict", rest: 120, sets: [{ warmup: true, target: { reps: 5, load: 20 } }, { target: { reps: 5, repsMax: 8, load: 40, rpe: 8 } }] },
    { exercise: row, sets: [{ target: { reps: 10, load: 50 } }] },
  ]);
  assert.equal((await store.saveWorkout(templateId, 0, { ...draft, notes: "Plan: add 2.5 kg when all sets reach eight." })).ok, true);

  const id = crypto.randomUUID();
  const made = await store.createWorkout({ id, status: "planned", day: today, templateId });
  assert.equal(made, id);
  assert.equal(await store.createWorkout({ id, status: "planned", day: today, templateId }), id);
  const [count] = await schema.rows<{ workouts: number; sets: number }>(
    "SELECT (SELECT count(*) FROM workouts WHERE template_id IS NOT NULL)::int AS workouts, (SELECT count(*) FROM workout_sets WHERE workout_id = $1)::int AS sets", [id],
  );
  assert.deepEqual(count, { workouts: 1, sets: 3 });

  const doc = (await store.loadWorkout(id))!;
  const template = (await store.loadWorkout(templateId))!;
  assert.equal(doc.title, "Push day");
  assert.equal(doc.notes, "", "a template's planning notes are not published with the session");
  assert.equal(doc.templateId, templateId);
  assert.equal(doc.status, "planned");
  assert.equal(doc.revision, 0);
  assert.deepEqual(doc.blocks.map((block) => [block.exerciseId, block.notes, block.restSeconds]), [[press.id, "strict", 120], [row.id, "", null]]);
  assert.deepEqual(doc.blocks.map((block) => block.sets.map((set) => [set.warmup, set.target])),
    template.blocks.map((block) => block.sets.map((set) => [set.warmup, set.target])));
  assert.ok(doc.blocks.every((block) => block.sets.every((set) => set.loggedAt === null && set.actual.reps === null)));
  const ids = new Set([...doc.blocks.map((b) => b.id), ...doc.blocks.flatMap((b) => b.sets.map((s) => s.id))]);
  for (const block of template.blocks) {
    assert.equal(ids.has(block.id), false);
    for (const set of block.sets) assert.equal(ids.has(set.id), false);
  }
});

test("creating a workout validates its input", { skip }, async () => {
  await reset();
  await assert.rejects(store.createWorkout({ status: "planned", title: "x", day: null }), WorkoutInputError);
  await assert.rejects(store.createWorkout({ status: "planned", title: "x", day: "2026-02-30" }), WorkoutInputError);
  await assert.rejects(store.createWorkout({ status: "planned", title: "  ", day: today }), WorkoutInputError);
  await assert.rejects(store.createWorkout({ status: "planned", day: today, templateId: crypto.randomUUID() }), WorkoutInputError);
  const plannedId = await planned(today, []);
  await assert.rejects(store.createWorkout({ status: "planned", day: today, templateId: plannedId }), WorkoutInputError);
  const template = await store.createWorkout({ status: "template", title: "T", day: today });
  assert.equal((await store.loadWorkout(template))!.day, null);
  const [count] = await schema.rows<{ count: number }>("SELECT count(*)::int AS count FROM workouts");
  assert.equal(count.count, 2);
});

test("a template made from a planned session takes logged values as targets and keeps the rest", { skip }, async () => {
  await reset();
  const id = await planned(today, [
    {
      exercise: squat, notes: "depth", rest: 200,
      sets: [
        { warmup: true, target: { reps: 5, load: 40 }, reps: 5, load: 50, done: true },
        { target: { reps: 5, repsMax: 8, load: 100, rpe: 8 }, reps: 6, load: 102.5, rpe: 9, done: true },
        { target: { reps: 5, load: 100 }, reps: 3 },
      ],
    },
    { exercise: plank, sets: [{ target: { duration: 60 } }] },
  ]);
  const newId = crypto.randomUUID();
  assert.equal(await store.copyToTemplate(id, { id: newId, title: "  My legs " }), newId);
  assert.equal(await store.copyToTemplate(id, { id: newId, title: "again" }), newId);
  const template = (await store.loadWorkout(newId))!;
  assert.equal(template.status, "template");
  assert.equal(template.title, "My legs");
  assert.equal(template.day, null);
  assert.deepEqual(template.blocks.map((block) => [block.exerciseId, block.notes, block.restSeconds]), [[squat.id, "depth", 200], [plank.id, "", null]]);
  const [warm, work, draft] = template.blocks[0].sets;
  assert.deepEqual([warm.warmup, warm.target.reps, warm.target.load], [true, 5, 50]);
  assert.deepEqual([work.target.reps, work.target.load, work.target.rpe, work.target.repsMax], [6, 102.5, 8, 8]);
  assert.deepEqual([draft.target.reps, draft.target.load], [5, 100]);
  assert.equal(template.blocks[1].sets[0].target.duration, 60);
  assert.ok(template.blocks.every((block) => block.sets.every((set) => set.loggedAt === null && set.actual.reps === null)));
});

test("a template made from a completed session skips unlogged sets and empty blocks", { skip }, async () => {
  await reset();
  const id = await completed(addDays(today, -1), [
    { exercise: squat, sets: [lifted(5, 100), { reps: 3, load: 100 }] },
    { exercise: press, sets: [{ target: { reps: 5 } }] },
  ]);
  const newId = await store.copyToTemplate(id, { title: "Squat only" });
  const template = (await store.loadWorkout(newId))!;
  assert.equal(template.blocks.length, 1);
  assert.equal(template.blocks[0].sets.length, 1);
  assert.equal(template.blocks[0].sets[0].target.load, 100);
  assert.equal(template.blocks[0].sets[0].target.reps, 5);
});

test("a template cannot be made from nothing, from a template, or without a name", { skip }, async () => {
  await reset();
  const empty = await planned(today, [{ exercise: squat, sets: [] }]);
  await assert.rejects(store.copyToTemplate(empty, { title: "T" }), WorkoutInputError);
  const other = await completed(addDays(today, -1), [{ exercise: squat, sets: [lifted(5, 100)] }]);
  await assert.rejects(store.copyToTemplate(other, { title: " " }), WorkoutInputError);
  await assert.rejects(store.copyToTemplate(crypto.randomUUID(), { title: "T" }), WorkoutInputError);
  const template = await store.copyToTemplate(other, { title: "T" });
  await assert.rejects(store.copyToTemplate(template, { title: "T2" }), WorkoutInputError);
  const [count] = await schema.rows<{ count: number }>("SELECT count(*)::int AS count FROM workouts WHERE status = 'template'");
  assert.equal(count.count, 1);
});

test("a session can only be finished with a logged set and a date that is not in the future", { skip }, async () => {
  await reset();
  const blank = await planned(today, [{ exercise: squat, sets: [{ reps: 5, load: 100 }] }]);
  await assert.rejects(store.completeWorkout(blank), /at least one set/);
  const future = await planned(addDays(today, 2), [{ exercise: squat, sets: [lifted(5, 100)] }]);
  await assert.rejects(store.completeWorkout(future), /future/);
  const template = await store.createWorkout({ status: "template", title: "T" });
  await assert.rejects(store.completeWorkout(template), WorkoutInputError);
  await assert.rejects(store.completeWorkout(crypto.randomUUID()), WorkoutInputError);

  const ready = await planned(today, [{ exercise: squat, sets: [lifted(5, 100)] }]);
  await store.completeWorkout(ready);
  const done = (await store.loadWorkout(ready))!;
  assert.equal(done.status, "completed");
  assert.ok(done.completedAt);
  assert.equal(done.revision, 2);
  await store.completeWorkout(ready);
  assert.equal((await store.loadWorkout(ready))!.completedAt, done.completedAt);

  await store.reopenWorkout(ready);
  const reopened = (await store.loadWorkout(ready))!;
  assert.equal(reopened.status, "planned");
  assert.equal(reopened.completedAt, null);
});

test("deleting a workout removes it with its blocks and sets, but keeps sessions started from a template", { skip }, async () => {
  await reset();
  const templateId = await store.createWorkout({ status: "template", title: "T" });
  assert.equal((await store.saveWorkout(templateId, 0, draftOf("T", null, [{ exercise: squat, sets: [{}] }]))).ok, true);
  const session = await store.createWorkout({ status: "planned", day: today, templateId });
  await store.deleteWorkout(templateId);
  assert.equal(await store.loadWorkout(templateId), null);
  assert.equal((await store.loadWorkout(session))!.templateId, null);
  await store.deleteWorkout(session);
  await store.deleteWorkout(session);
  const [counts] = await schema.rows<{ blocks: number; sets: number }>(
    "SELECT (SELECT count(*) FROM workout_exercises)::int AS blocks, (SELECT count(*) FROM workout_sets)::int AS sets",
  );
  assert.deepEqual(counts, { blocks: 0, sets: 0 });
});

test("an exercise that is in a workout cannot be deleted, an unused one can", { skip }, async () => {
  await reset();
  const id = await store.createWorkout({ status: "planned", day: today, title: "x" });
  const spare = await store.saveExercise({ name: "Spare", tracking: "weight_reps", equipment: "other", primaryMuscle: "Back" });
  const field = await store.saveField({ label: "Grip", kind: "integer", exerciseId: spare.id });
  assert.equal((await store.saveWorkout(id, 0, draftOf("x", today, [{ exercise: spare, sets: [{}] }]))).ok, true);
  assert.equal(await store.deleteExercise(spare.id), "in_use");
  await store.deleteWorkout(id);
  assert.equal(await store.deleteExercise(spare.id), "deleted");
  assert.equal((await store.listFields()).some((entry) => entry.id === field.id), false);
  assert.equal(await store.deleteExercise(spare.id), "deleted");
});

test("exercises are validated, saved, archived and listed", { skip }, async () => {
  await reset();
  const input = { name: "Zercher squat", tracking: "weight_reps" as const, equipment: "barbell" as const, primaryMuscle: "Quads" };
  await assert.rejects(store.saveExercise({ ...input, name: "  " }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, name: "x".repeat(101) }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, primaryMuscle: "" }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, barKg: 101 }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, restSeconds: 3601 }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, notes: "x".repeat(501) }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, secondaryMuscles: Array.from({ length: 9 }, (_, index) => `m${index}`) }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, tracking: "nope" as never }), WorkoutInputError);
  await assert.rejects(store.saveExercise({ ...input, id: crypto.randomUUID() }), WorkoutInputError);

  const saved = await store.saveExercise({
    ...input, barKg: 15, restSeconds: 90, secondaryMuscles: [" Glutes ", "glutes", "Core", ""], notes: " cue ",
  });
  assert.deepEqual([saved.barKg, saved.restSeconds, saved.secondaryMuscles, saved.notes, saved.archived], [15, 90, ["Glutes", "Core"], "cue", false]);
  const cable = await store.saveExercise({ ...input, id: saved.id, equipment: "cable", barKg: 15 });
  assert.equal(cable.id, saved.id);
  assert.equal(cable.barKg, null);

  await store.setExerciseArchived(saved.id, true);
  assert.equal((await store.listExercises()).some((entry) => entry.id === saved.id), false);
  const all = await store.listExercises({ includeArchived: true });
  assert.equal(all.find((entry) => entry.id === saved.id)?.archived, true);
  const names = all.map((entry) => entry.name.toLowerCase());
  assert.deepEqual(names, [...names].sort());
  await store.setExerciseArchived(saved.id, false);
  assert.equal((await store.listExercises()).some((entry) => entry.id === saved.id), true);
  await store.deleteExercise(saved.id);
});

test("fields are validated and saved", { skip }, async () => {
  await reset();
  await assert.rejects(store.saveField({ label: "", kind: "text" }), WorkoutInputError);
  await assert.rejects(store.saveField({ label: "x".repeat(61), kind: "text" }), WorkoutInputError);
  await assert.rejects(store.saveField({ label: "ok", unit: "x".repeat(21), kind: "text" }), WorkoutInputError);
  await assert.rejects(store.saveField({ label: "ok", kind: "float" as never }), WorkoutInputError);
  await assert.rejects(store.saveField({ label: "ok", kind: "text", exerciseId: crypto.randomUUID() }), WorkoutInputError);
  const field = await store.saveField({ label: " Zone ", unit: "bpm", kind: "integer", exerciseId: squat.id });
  assert.deepEqual([field.label, field.unit, field.kind, field.exerciseId], ["Zone", "bpm", "integer", squat.id]);
  const renamed = await store.saveField({ id: field.id, label: "Heart", kind: "decimal" });
  assert.deepEqual([renamed.label, renamed.exerciseId], ["Heart", null]);
  await store.deleteField(field.id);
  assert.equal((await store.listFields()).length, 0);
});

test("history is the latest completed session with a logged set, and respects before and exclude", { skip }, async () => {
  await reset();
  const oldest = await completed(addDays(today, -20), [{ exercise: squat, sets: [lifted(5, 100)] }]);
  const middle = await completed(addDays(today, -10), [
    { exercise: squat, sets: [lifted(5, 60, { warmup: true }), lifted(5, 105), lifted(4, 105, { rpe: 9 })] },
    { exercise: press, sets: [lifted(5, 40)] },
    { exercise: squat, sets: [lifted(8, 80)] },
  ]);
  await completed(addDays(today, -5), [{ exercise: squat, sets: [{ reps: 5, load: 200 }] }, { exercise: press, sets: [lifted(5, 42.5)] }]);
  await planned(addDays(today, -1), [{ exercise: squat, sets: [lifted(5, 300)] }]);

  const found = await store.exerciseHistory([squat.id, press.id, row.id], { before: null });
  assert.deepEqual(Object.keys(found).sort(), [press.id, squat.id].sort());
  assert.equal(found[press.id].sets[0].measures.load, 42.5);
  assert.equal(found[squat.id].workoutId, middle);
  assert.equal(found[squat.id].day, addDays(today, -10));
  assert.deepEqual(found[squat.id].sets.map((set) => [set.warmup, set.measures.reps, set.measures.load, set.measures.rpe]),
    [[true, 5, 60, null], [false, 5, 105, null], [false, 4, 105, 9], [false, 8, 80, null]]);

  const before = await store.exerciseHistory([squat.id], { before: addDays(today, -10) });
  assert.equal(before[squat.id].workoutId, middle);
  const earlier = await store.exerciseHistory([squat.id], { before: addDays(today, -11) });
  assert.equal(earlier[squat.id].workoutId, oldest);
  const excluded = await store.exerciseHistory([squat.id], { before: null, excludeWorkoutId: middle });
  assert.equal(excluded[squat.id].workoutId, oldest);
  assert.deepEqual(await store.exerciseHistory([], { before: null }), {});
  assert.deepEqual(await store.exerciseHistory([squat.id], { before: addDays(today, -30) }), {});
});

test("on the same day the session logged last is the history", { skip }, async () => {
  await reset();
  const morning = await completed(addDays(today, -2), [{ exercise: squat, sets: [lifted(5, 100, { at: `${addDays(today, -2)}T07:00:00.000Z` })] }]);
  const evening = await completed(addDays(today, -2), [{ exercise: squat, sets: [lifted(5, 110, { at: `${addDays(today, -2)}T17:00:00.000Z` })] }]);
  const found = await store.exerciseHistory([squat.id], { before: null });
  assert.equal(found[squat.id].workoutId, evening);
  assert.notEqual(found[squat.id].workoutId, morning);
});

test("the public page shows logged sets of completed workouts only", { skip }, async () => {
  await reset();
  const field = await store.saveField({ label: "Tempo", kind: "text" });
  const day = addDays(today, -3);
  const start = `${day}T09:00:00.000Z`;
  const id = await completed(day, [
    { exercise: squat, notes: "belt", sets: [lifted(5, 60, { warmup: true, at: start }), lifted(5, 100, { at: `${day}T09:10:00.000Z`, custom: { [field.id]: "slow" } }), { reps: 5, load: 100 }] },
    { exercise: press, sets: [{ reps: 5, load: 40 }] },
    { exercise: row, sets: [lifted(10, 50, { rpe: 8, at: `${day}T09:40:00.000Z` })] },
  ], "Legs");
  const older = await completed(addDays(day, -2), [{ exercise: squat, sets: [lifted(5, 90)] }], "Older");
  const newer = await completed(addDays(day, 1), [{ exercise: squat, sets: [lifted(5, 95)] }], "Newer");
  await completed(addDays(day, -1), [{ exercise: squat, sets: [lifted(5, 95)] }], "Between");
  await schema.rows("UPDATE workouts SET started_at = NULL WHERE id = $1", [id]);

  const page = (await pub.publicWorkout(id))!;
  assert.equal(page.title, "Legs");
  assert.equal(page.day, day);
  assert.deepEqual(page.blocks.map((block) => block.exercise.name), ["Squat", "Row"]);
  assert.deepEqual(page.blocks[0].sets.map((set) => [set.warmup, set.measures.load]), [[true, 60], [false, 100]]);
  assert.deepEqual(page.blocks[0].sets[1].custom, { [field.id]: "slow" });
  assert.equal(page.blocks[0].notes, "belt");
  assert.equal(page.blocks[0].exercise.primaryMuscle, "Quads");
  assert.equal(page.minutes, 40);
  assert.deepEqual(page.summary, { workSets: 2, volume: 500 + 500, averageRpe: 8 });
  assert.deepEqual(page.muscles, [{ name: "Back", sets: 1 }, { name: "Quads", sets: 1 }]);
  assert.equal(page.fields.length, 1);
  assert.equal(page.older?.title, "Between");
  assert.equal(page.newer?.id, newer);
  const oldestPage = (await pub.publicWorkout(older))!;
  assert.equal(oldestPage.older, null);
  assert.equal(oldestPage.newer?.title, "Between");
  assert.equal(await pub.publicWorkout("not-an-id"), null);
});

test("a planned workout is not public, and short or forgotten sessions have no duration", { skip }, async () => {
  await reset();
  const draft = await planned(today, [{ exercise: squat, sets: [lifted(5, 100)] }]);
  assert.equal(await pub.publicWorkout(draft), null);
  assert.equal(await pub.publicWorkout(crypto.randomUUID()), null);
  const day = addDays(today, -1);
  const quick = await completed(day, [{ exercise: squat, sets: [lifted(5, 100, { at: `${day}T09:00:00.000Z` }), lifted(5, 100, { at: `${day}T09:02:00.000Z` })] }]);
  await schema.rows("UPDATE workouts SET started_at = NULL WHERE id = $1", [quick]);
  assert.equal((await pub.publicWorkout(quick))!.minutes, null);
  const long = await completed(day, [{ exercise: squat, sets: [lifted(5, 100, { at: `${day}T01:00:00.000Z` }), lifted(5, 100, { at: `${day}T23:00:00.000Z` })] }]);
  await schema.rows("UPDATE workouts SET started_at = NULL WHERE id = $1", [long]);
  assert.equal((await pub.publicWorkout(long))!.minutes, null);
});

test("weeks group completed sessions, newest week first, sessions oldest first", { skip }, async () => {
  await reset();
  const lastMonday = addDays(thisMonday, -7);
  const older = addDays(thisMonday, -21);
  const a = await completed(addDays(lastMonday, 2), [
    { exercise: squat, sets: [lifted(5, 60, { warmup: true }), lifted(5, 100), lifted(5, 100), lifted(5, 105)] },
    { exercise: press, sets: [lifted(8, 40, { rpe: 8 })] },
  ], "Wednesday");
  const b = await completed(lastMonday, [{ exercise: row, sets: [lifted(10, 50)] }], "Monday");
  const c = await completed(addDays(older, 1), [{ exercise: plank, sets: [{ duration: 60, done: true }] }], "Plank day");
  await planned(today, [{ exercise: squat, sets: [lifted(5, 500)] }], "Not done");

  const weeks = await pub.publicWeeks();
  assert.deepEqual(weeks.map((week) => week.start), [lastMonday, older]);
  assert.deepEqual(weeks[0], {
    ...isoWeek(lastMonday), start: lastMonday, workSets: 5, volume: 2345,
    sessions: weeks[0].sessions,
  });
  assert.deepEqual(weeks[0].sessions.map((session) => session.id), [b, a]);
  const wednesday = weeks[0].sessions[1];
  assert.equal(wednesday.workSets, 4);
  assert.equal(wednesday.volume, 500 + 500 + 525 + 320);
  assert.deepEqual(wednesday.blocks.map((block) => block.exercise.name), ["Squat", "Press"]);
  assert.deepEqual(wednesday.blocks[0].runs.map((run) => [run.count, run.measures.load]), [[2, 100], [1, 105]]);
  assert.deepEqual([wednesday.blocks[0].top?.load, wednesday.blocks[0].top?.reps], [105, 5]);
  assert.equal(weeks[1].sessions[0].id, c);
  assert.equal(weeks[1].sessions[0].blocks[0].top, null);
  assert.equal(weeks[1].sessions[0].blocks[0].runs[0].measures.duration, 60);

  const limited = await pub.publicWeeks({ limit: 1 });
  assert.deepEqual(limited.map((week) => week.start), [lastMonday]);
  await reset();
  assert.deepEqual(await pub.publicWeeks(), []);
});

test("totals, best lifts and weekly volume come from logged working sets of completed sessions", { skip }, async () => {
  await reset();
  assert.deepEqual(await pub.publicTotals(), { sessions: 0, firstDay: null, lastDay: null });
  assert.deepEqual(await pub.publicBestLifts(), []);

  const first = addDays(thisMonday, -22);
  const second = addDays(thisMonday, -2);
  await completed(first, [
    { exercise: squat, sets: [lifted(5, 100), lifted(1, 120), lifted(12, 100), lifted(5, 200, { warmup: true })] },
    { exercise: press, sets: [lifted(5, 40)] },
  ]);
  await completed(second, [{ exercise: squat, sets: [lifted(3, 110)] }, { exercise: plank, sets: [{ duration: 90, done: true }] }]);
  await planned(today, [{ exercise: squat, sets: [lifted(5, 400)] }]);

  assert.deepEqual(await pub.publicTotals(), { sessions: 2, firstDay: first, lastDay: second });

  const lifts = await pub.publicBestLifts();
  assert.deepEqual(lifts.map((lift) => lift.name), ["Squat", "Press"]);
  assert.deepEqual([lifts[0].load, lifts[0].reps, lifts[0].day], [110, 3, second]);
  assert.ok(Math.abs(lifts[0].estimate - 121) < 1e-6);
  assert.equal(lifts[0].equipment, "barbell");
  assert.equal(lifts[0].barKg, null);
  assert.equal((await pub.publicBestLifts(1)).length, 1);
});

test("the desk sorts sessions into where the owner is", { skip }, async () => {
  await reset();
  const started = await planned(addDays(today, -2), [{ exercise: squat, sets: [lifted(5, 100), { reps: 5, load: 100 }] }], "Half done");
  const todays = await planned(today, [{ exercise: squat, sets: [{}] }, { exercise: press, sets: [{}] }], "Today");
  const late = await planned(addDays(today, -3), [{ exercise: press, sets: [{}] }], "Late");
  const later = await planned(addDays(today, -1), [{ exercise: press, sets: [{}] }], "Later");
  const soon = await planned(addDays(today, 1), [{ exercise: press, sets: [{}] }], "Soon");
  const soonest = await planned(addDays(today, 5), [{ exercise: press, sets: [{}] }], "Not soon");
  const done = await completed(addDays(today, -4), [{ exercise: squat, sets: [lifted(5, 100)] }], "Done");

  const template = await store.createWorkout({ status: "template", title: "Template A" });
  await store.saveWorkout(template, 0, draftOf("Template A", null, [{ exercise: squat, sets: [{}, {}] }, { exercise: press, sets: [{}] }]));
  const unused = await store.createWorkout({ status: "template", title: "Template B" });
  const usedOnce = await store.createWorkout({ status: "planned", day: addDays(today, -9), templateId: template });
  await store.createWorkout({ status: "planned", day: addDays(today, 9), templateId: template });

  const desk = await store.deskData();
  assert.equal(desk.today, today);
  assert.deepEqual(desk.inProgress.map((entry) => entry.id), [started]);
  assert.deepEqual([desk.inProgress[0].setCount, desk.inProgress[0].loggedCount, desk.inProgress[0].exerciseCount], [2, 1, 1]);
  assert.ok(desk.inProgress[0].startedAt);
  assert.deepEqual(desk.todayPlanned.map((entry) => entry.id), [todays]);
  assert.deepEqual(desk.todayPlanned[0].exercises, ["Squat", "Press"]);
  assert.deepEqual(desk.overdue.map((entry) => entry.id), [later, late, usedOnce]);
  assert.equal(desk.upcoming[0].id, soon);
  assert.equal(desk.upcoming[1].id, soonest);
  assert.equal(desk.upcoming.at(-1)!.day, addDays(today, 9));
  assert.deepEqual(desk.recent.map((entry) => entry.id), [done]);
  assert.equal(desk.recent[0].status, "completed");
  assert.deepEqual(desk.templates.map((entry) => entry.title), ["Template A", "Template B"]);
  assert.deepEqual(desk.templates.map((entry) => entry.id), [template, unused]);
  // Sessions that were only planned from a template do not count as using it.
  assert.deepEqual([desk.templates[0].exerciseCount, desk.templates[0].setCount, desk.templates[0].timesUsed, desk.templates[0].lastUsed],
    [2, 3, 0, null]);
  assert.deepEqual([desk.templates[1].timesUsed, desk.templates[1].lastUsed], [0, null]);
  assert.deepEqual(desk.counts, { exercises: 4, completed: 1 });

  await schema.rows("UPDATE workouts SET started_at = now() WHERE id = $1", [usedOnce]);
  const after = await store.deskData();
  assert.deepEqual([after.templates[0].id, after.templates[0].timesUsed, after.templates[0].lastUsed], [template, 1, addDays(today, -9)]);
});

test("the library counts sessions and finds the best lift per exercise", { skip }, async () => {
  await reset();
  await completed(addDays(today, -6), [{ exercise: squat, sets: [lifted(5, 100), lifted(10, 80)] }]);
  await completed(addDays(today, -2), [{ exercise: squat, sets: [lifted(3, 110)] }, { exercise: plank, sets: [{ duration: 60, done: true }] }]);
  await planned(today, [{ exercise: squat, sets: [lifted(5, 300)] }]);
  await store.saveField({ label: "Tempo", kind: "text", exerciseId: squat.id });
  await store.saveField({ label: "Everywhere", kind: "text" });

  const library = await store.exerciseLibrary();
  const by = new Map(library.map((entry) => [entry.name, entry]));
  assert.equal(by.get("Squat")!.sessions, 2);
  assert.equal(by.get("Squat")!.lastDay, addDays(today, -2));
  assert.deepEqual([by.get("Squat")!.best?.load, by.get("Squat")!.best?.reps], [110, 3]);
  assert.ok(Math.abs(by.get("Squat")!.best!.estimate - 121) < 1e-6);
  assert.equal(by.get("Squat")!.fieldCount, 1);
  assert.equal(by.get("Plank")!.best, null);
  assert.equal(by.get("Plank")!.sessions, 1);
  assert.equal(by.get("Row")!.sessions, 0);
  assert.equal(by.get("Row")!.lastDay, null);
  const names = library.map((entry) => entry.name.toLowerCase());
  assert.deepEqual(names, [...names].sort());
});

test("document sets that were never typed into stay empty through a save", { skip }, async () => {
  await reset();
  const id = await planned(today, [{ exercise: squat, sets: [{}, {}] }]);
  const doc: WorkoutDoc = (await store.loadWorkout(id))!;
  assert.ok(doc.blocks[0].sets.every((set) => set.loggedAt === null && set.actual.reps === null && Object.keys(set.custom).length === 0));
});

test("malformed history arguments are ignored like malformed ids", { skip }, async () => {
  await reset();
  const id = await completed(addDays(today, -2), [{ exercise: squat, sets: [lifted(5, 100)] }]);
  const found = await store.exerciseHistory([squat.id], { before: null, excludeWorkoutId: "nope" });
  assert.equal(found[squat.id].workoutId, id);
  assert.deepEqual(await store.exerciseHistory([squat.id], { before: "yesterday" }), {});
});

test("a NUL character or an impossible logging time comes back as invalid, never as a database error", { skip }, async () => {
  await reset();
  const id = await planned(today, [{ exercise: squat, sets: [{}] }]);
  const doc = (await store.loadWorkout(id))!;
  const send = (changes: Record<string, unknown>) => store.saveWorkout(id, doc.revision, { title: "T", day: today, notes: "", blocks: doc.blocks, ...changes });
  for (const changes of [{ title: "a\u0000b" }, { notes: "a\u0000b" }]) {
    const result = await send(changes);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "invalid");
  }
  const logged = { ...doc.blocks[0], sets: [{ ...doc.blocks[0].sets[0], actual: { ...noMeasures, reps: 5 } }] };
  for (const loggedAt of ["-271821-04-20T00:00:00Z", "0001-01-01T00:00:00Z"]) {
    const result = await send({ blocks: [{ ...logged, sets: [{ ...logged.sets[0], loggedAt }] }] });
    assert.equal(!result.ok && result.reason, "invalid", loggedAt);
  }
  assert.equal((await store.loadWorkout(id))!.revision, doc.revision);
  await assert.rejects(() => store.saveExercise({ name: "a\u0000b", tracking: "weight_reps", equipment: "other", primaryMuscle: "Back" }), WorkoutInputError);
  await assert.rejects(() => store.saveExercise({ name: "Ok", tracking: "weight_reps", equipment: "other", primaryMuscle: "Back", secondaryMuscles: ["a\u0000b"] }), WorkoutInputError);
  await assert.rejects(() => store.saveField({ label: "a\u0000b", kind: "text" }), WorkoutInputError);
  await assert.rejects(() => store.createWorkout({ status: "planned", day: today, title: "a\u0000b" }), WorkoutInputError);
  await assert.rejects(() => store.copyToTemplate(id, { title: "a\u0000b" }), WorkoutInputError);
});

test("the desk keeps the session that started last when completed workouts tie on the cutoff day", { skip }, async () => {
  await reset();
  const day = addDays(today, -1);
  const ids: string[] = [];
  for (let n = 0; n < 11; n += 1) ids.push(await completed(day, [{ exercise: squat, sets: [lifted(5, 100 + n)] }], `S${n}`));
  const byId = [...ids].sort();
  const latest = byId[10];
  for (const [n, id] of byId.entries()) {
    await schema.rows("UPDATE workouts SET started_at = $2::timestamptz WHERE id = $1", [id, `${day}T${id === latest ? "20" : "08"}:${String(n).padStart(2, "0")}:00Z`]);
  }
  const desk = await store.deskData();
  assert.equal(desk.recent.length, 10);
  assert.equal(desk.recent[0].id, latest);
  assert.ok(!desk.recent.some((entry) => entry.id === byId[0]));
});

test("neighbouring sessions of one day follow the order they were started in", { skip }, async () => {
  await reset();
  const day = addDays(today, -2);
  const first = await completed(day, [{ exercise: squat, sets: [lifted(5, 100)] }], "First");
  const second = await completed(day, [{ exercise: squat, sets: [lifted(5, 100)] }], "Second");
  const third = await completed(day, [{ exercise: squat, sets: [lifted(5, 100)] }], "Third");
  const times: [string, string][] = [[first, "07:00"], [second, "12:00"], [third, "18:00"]];
  for (const [id, time] of times) await schema.rows("UPDATE workouts SET started_at = $2::timestamptz WHERE id = $1", [id, `${day}T${time}:00Z`]);
  const [a, b, c] = await Promise.all([first, second, third].map((id) => pub.publicWorkout(id)));
  assert.equal(a!.older, null);
  assert.equal(a!.newer?.id, second);
  assert.equal(b!.older?.id, first);
  assert.equal(b!.newer?.id, third);
  assert.equal(c!.older?.id, second);
  assert.equal(c!.newer, null);
  const week = (await pub.publicWeeks()).flatMap((entry) => entry.sessions).filter((entry) => entry.day === day);
  assert.deepEqual(week.map((entry) => entry.id), [first, second, third]);
});

test("session minutes are tested before rounding", { skip }, async () => {
  await reset();
  const day = addDays(today, -1);
  const span = async (seconds: number) => {
    const id = await completed(day, [{ exercise: squat, sets: [lifted(5, 100, { at: `${day}T06:00:00.000Z` }), lifted(5, 100, { at: new Date(Date.parse(`${day}T06:00:00.000Z`) + seconds * 1000).toISOString() })] }]);
    await schema.rows("UPDATE workouts SET started_at = NULL WHERE id = $1", [id]);
    return (await pub.publicWorkout(id))!.minutes;
  };
  assert.equal(await span(270), null);
  assert.equal(await span(299), null);
  assert.equal(await span(300), 5);
  assert.equal(await span(21600), 360);
  assert.equal(await span(21624), null);
});

test("a pasted sheet becomes templates, and exercises are added once", { skip }, async () => {
  await reset();
  const sheet = ["Squat\t3\t5\t100", "Squat\t1\t3\t110", "Pullups\t3\t6-8\tbw+5kg", "Side planks\t1\t60\teach side", "", "", "Pullups\t2\t5\tRPE9"].join("\n");
  const before = (await store.listExercises({ includeArchived: true })).length;

  const made = await store.importTemplates(sheet, [{ index: 0, title: "Day one" }, { index: 1, title: " Day two " }]);
  assert.deepEqual(made.templates.map(({ title, exercises, sets }) => [title, exercises, sets]), [["Day one", 3, 8], ["Day two", 1, 2]]);
  assert.deepEqual(made.newExercises, ["Pullups", "Side planks"]);
  assert.equal((await store.listExercises({ includeArchived: true })).length, before + 2);

  const doc = (await store.loadWorkout(made.templates[0].id))!;
  assert.deepEqual([doc.status, doc.day, doc.blocks[0].exerciseId], ["template", null, squat.id]);
  assert.deepEqual(doc.blocks[0].sets.map((set) => [set.target.load, set.target.reps]), [[100, 5], [100, 5], [100, 5], [110, 3]]);
  assert.deepEqual(doc.blocks[1].sets.map((set) => [set.target.load, set.target.reps, set.target.repsMax]), [[5, 6, 8], [5, 6, 8], [5, 6, 8]]);
  assert.deepEqual([doc.blocks[2].sets[0].target.duration, doc.blocks[2].notes], [60, "each side"]);

  // A second paste reuses the exercises and leaves the first templates alone.
  const again = await store.importTemplates(sheet, [{ index: 1, title: "Day two again" }]);
  assert.deepEqual(again.newExercises, []);
  assert.equal((await store.listExercises({ includeArchived: true })).length, before + 2);
  assert.equal((await store.loadWorkout(made.templates[0].id))!.revision, doc.revision);

  await assert.rejects(store.importTemplates(sheet, [{ index: 9, title: "Nope" }]), WorkoutInputError);
  await assert.rejects(store.importTemplates(sheet, [{ index: 0, title: "" }]), WorkoutInputError);
  await assert.rejects(store.importTemplates(sheet, [{ index: 0, title: "A" }, { index: 0, title: "B" }]), WorkoutInputError);
  await assert.rejects(store.importTemplates("", [{ index: 0, title: "A" }]), WorkoutInputError);
  await assert.rejects(store.importTemplates(sheet, []), WorkoutInputError);
});

test("daily vitals load for rest days without a workout and apply manual precedence", { skip }, async () => {
  await reset();
  const restDay = "2026-11-24";
  const prevGoogle = process.env.PUBLISH_GOOGLE_HEALTH;
  const prevWithings = process.env.PUBLISH_WITHINGS;
  try {
    await schema.rows(
      `INSERT INTO health_observations (provider, external_id, metric, local_day, observed_at, value) VALUES
        ('google-health', $1, 'sleep_minutes', $2::date, '2026-11-24T06:30:00Z', 450),
        ('google-health', $1, 'resting_heart_rate', $2::date, NULL, 57),
        ('withings', 'late', 'body_weight_kg', $2::date, '2026-11-24T10:30:00Z', 90.2),
        ('withings', 'morning', 'body_weight_kg', $2::date, '2026-11-24T06:15:00Z', 88.7)`,
      [restDay, restDay],
    );

    process.env.PUBLISH_GOOGLE_HEALTH = "true";
    process.env.PUBLISH_WITHINGS = "true";
    assert.deepEqual(await pub.dailyVitals(restDay), {
      resting_heart_rate: 57,
      sleep_minutes: 450,
      sleep_score: null,
      body_weight_kg: 88.7,
    });

    process.env.PUBLISH_GOOGLE_HEALTH = "false";
    process.env.PUBLISH_WITHINGS = "false";
    assert.deepEqual(await pub.dailyVitals(restDay), {
      resting_heart_rate: null,
      sleep_minutes: null,
      sleep_score: null,
      body_weight_kg: null,
    });

    process.env.PUBLISH_GOOGLE_HEALTH = "true";
    process.env.PUBLISH_WITHINGS = "true";
    await schema.rows(
      "INSERT INTO published_daily_vitals (local_day, resting_heart_rate, sleep_minutes, sleep_score) VALUES ($1::date, 55, NULL, 86)",
      [restDay],
    );
    assert.deepEqual(await pub.dailyVitals(restDay), {
      resting_heart_rate: 55,
      sleep_minutes: 450,
      sleep_score: 86,
      body_weight_kg: 88.7,
    });
  } finally {
    if (prevGoogle === undefined) delete process.env.PUBLISH_GOOGLE_HEALTH;
    else process.env.PUBLISH_GOOGLE_HEALTH = prevGoogle;
    if (prevWithings === undefined) delete process.env.PUBLISH_WITHINGS;
    else process.env.PUBLISH_WITHINGS = prevWithings;
    await schema.rows("DELETE FROM health_observations WHERE local_day = $1::date", [restDay]);
    await schema.rows("DELETE FROM published_daily_vitals WHERE local_day = $1::date", [restDay]);
  }
});

