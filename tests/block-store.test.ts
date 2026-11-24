import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  WorkoutInputError, addDays, emptySet, noMeasures, stockholmDay, type ExerciseInfo, type SetTarget,
} from "../src/lib/workout-doc";
import { databaseUrl, isolatedSchema, schemaSql } from "./isolated-schema";

const skip = !databaseUrl;
type Store = typeof import("../src/lib/workout-store");
type Blocks = typeof import("../src/lib/block-store");

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: Store;
let blocks: Blocks;
let squat: ExerciseInfo;
let pullup: ExerciseInfo;
let plank: ExerciseInfo;
let legs: string;
let pull: string;

const today = stockholmDay();

before(async () => {
  if (skip) return;
  schema = await isolatedSchema(databaseUrl!);
  await schema.run(schemaSql);
  process.env.DATABASE_URL = schema.url;
  store = await import("../src/lib/workout-store");
  blocks = await import("../src/lib/block-store");
  squat = await store.saveExercise({ name: "Squat", tracking: "weight_reps", equipment: "barbell", primaryMuscle: "Quads" });
  pullup = await store.saveExercise({ name: "Pull-up", tracking: "bodyweight_reps", equipment: "bodyweight", primaryMuscle: "Back" });
  plank = await store.saveExercise({ name: "Plank", tracking: "duration", equipment: "other", primaryMuscle: "Core" });
});

after(async () => {
  if (skip) return;
  await (globalThis as { trainingPool?: { end(): Promise<void> } }).trainingPool?.end();
  await schema.drop();
});

type Planned = { exercise: ExerciseInfo; notes?: string; sets: Array<Partial<SetTarget>> };

async function template(title: string, plan: Planned[]): Promise<string> {
  const id = await store.createWorkout({ status: "template", title });
  const saved = await store.saveWorkout(id, 0, {
    title, day: null, notes: "Planning notes that stay with the template",
    blocks: plan.map(({ exercise, notes, sets }) => ({
      id: crypto.randomUUID(), exerciseId: exercise.id, notes: notes ?? "", restSeconds: null,
      sets: sets.map((target) => emptySet({ target: { ...noMeasures, repsMax: null, ...target } })),
    })),
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return id;
}

async function reset() {
  await schema.rows("DELETE FROM workouts");
  await schema.rows("DELETE FROM training_blocks");
  legs = await template("Legs", [
    { exercise: squat, notes: "Brace", sets: [{ reps: 5, load: 100 }, { reps: 5, load: 100 }, { reps: 3, load: 110 }] },
    { exercise: plank, sets: [{ duration: 60 }] },
  ]);
  pull = await template("Pull", [{ exercise: pullup, sets: [{ reps: 6, repsMax: 8, load: 5 }, { reps: 8 }] }]);
}

/** Log every set of a session as planned and finish it. */
async function train(id: string, change: (reps: number | null) => number | null = (reps) => reps) {
  const doc = (await store.loadWorkout(id))!;
  const saved = await store.saveWorkout(id, doc.revision, {
    title: doc.title, day: doc.day, notes: doc.notes,
    blocks: doc.blocks.map((block) => ({
      ...block,
      sets: block.sets.map((set) => ({
        ...set, loggedAt: new Date(Date.now() - 60_000).toISOString(),
        actual: { ...set.actual, reps: change(set.target.reps), load: set.target.load, duration: set.target.duration },
      })),
    })),
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  await store.completeWorkout(id, null);
}

test("a block is built from templates on the days of its week, heavier each week", { skip }, async () => {
  await reset();
  // 2026-11-29 is a Sunday: the week of a block starts on the day it is given.
  const id = await blocks.createBlock({
    title: "  Winter base ", startDay: "2026-11-29", weeks: 3, addKg: "2.5",
    layout: [{ offset: 2, templateId: pull }, { offset: 0, templateId: legs }, { offset: 5, templateId: legs }],
  });
  const block = (await blocks.loadBlock(id))!;
  assert.deepEqual([block.title, block.startDay, block.weeks, block.sessions, block.completed], ["Winter base", "2026-11-29", 3, 9, 0]);
  assert.deepEqual(block.weekList.map((week) => [week.week, week.start, week.sessions.map((session) => `${session.day} ${session.title}`)]), [
    [1, "2026-11-29", ["2026-11-29 Legs", "2026-12-01 Pull", "2026-12-04 Legs"]],
    [2, "2026-12-06", ["2026-12-06 Legs", "2026-12-08 Pull", "2026-12-11 Legs"]],
    [3, "2026-12-13", ["2026-12-13 Legs", "2026-12-15 Pull", "2026-12-18 Legs"]],
  ]);

  // Every load climbs by the step each week; a set without a load stays without one.
  const squatLine = (week: number) => block.weekList[week - 1].sessions[0].lines[0];
  assert.deepEqual(squatLine(1).planned.map((row) => [row.load, row.reps, row.count]), [[100, 5, 2], [110, 3, 1]]);
  assert.deepEqual(squatLine(3).planned.map((row) => [row.load, row.reps, row.count]), [[105, 5, 2], [115, 3, 1]]);
  assert.deepEqual(block.weekList[2].sessions[0].lines[1], {
    exercise: "Plank", tracking: "duration", planned: [{ count: 1, reps: null, repsMax: null, load: null, rpe: null, duration: 60 }], done: [],
  });
  assert.deepEqual(block.weekList[2].sessions[1].lines[0].planned.map((row) => [row.load, row.reps, row.repsMax]), [[10, 6, 8], [null, 8, null]]);

  // A session of a block is an ordinary planned session made from its template.
  const first = (await store.loadWorkout(block.weekList[0].sessions[0].id))!;
  assert.deepEqual([first.status, first.day, first.notes, first.blocks[0].notes, first.blocks[0].sets.length], ["planned", "2026-11-29", "", "Brace", 3]);
  const [{ template_id: from }] = await schema.rows("SELECT template_id FROM workouts WHERE id = $1", [first.id]);
  assert.equal(from, legs);
  assert.equal((await store.loadWorkout(legs))!.blocks[0].sets[0].target.load, 100);
});

test("a block refuses what it cannot build, and leaves nothing behind", { skip }, async () => {
  await reset();
  const good = { title: "Base", startDay: "2026-11-29", weeks: 4, layout: [{ offset: 0, templateId: legs }] };
  const gone = crypto.randomUUID();
  const session = await store.createWorkout({ status: "planned", title: "Not a template", day: today });
  for (const bad of [
    { ...good, title: " " }, { ...good, title: 7 }, { ...good, title: "x".repeat(121) },
    { ...good, startDay: "2026-02-30" }, { ...good, startDay: "tomorrow" },
    // A block lives between 2000 and 2100, so none of its weeks can fall off the calendar.
    { ...good, startDay: "9999-12-31" }, { ...good, startDay: "1999-12-31" },
    { ...good, weeks: 0 }, { ...good, weeks: 17 }, { ...good, weeks: 2.5 },
    { ...good, addKg: "-1" }, { ...good, addKg: "51" }, { ...good, addKg: "lots" },
    { ...good, layout: [] }, { ...good, layout: [{ offset: 7, templateId: legs }] },
    { ...good, layout: [{ offset: 0, templateId: legs }, { offset: 1, templateId: gone }] },
    { ...good, layout: [{ offset: 0, templateId: session }] },
  ]) {
    await assert.rejects(blocks.createBlock(bad), WorkoutInputError, JSON.stringify(bad));
  }
  assert.deepEqual(await blocks.listBlocks(), []);
  assert.equal((await schema.rows("SELECT 1 FROM workouts WHERE block_id IS NOT NULL")).length, 0);
});

test("the week view shows what was done next to what was planned", { skip }, async () => {
  await reset();
  const start = addDays(today, -8);
  const id = await blocks.createBlock({ title: "Now", startDay: start, weeks: 2, layout: [{ offset: 0, templateId: legs }, { offset: 1, templateId: pull }] });
  const made = (await blocks.loadBlock(id))!;
  await train(made.weekList[0].sessions[0].id, (reps) => (reps === 3 ? 2 : reps));

  const block = (await blocks.loadBlock(id))!;
  const [done, open] = block.weekList[0].sessions;
  assert.deepEqual([block.sessions, block.completed, done.status, done.setCount, done.loggedCount], [4, 1, "completed", 4, 4]);
  assert.deepEqual(done.lines[0].planned.map((row) => [row.load, row.reps, row.count]), [[100, 5, 2], [110, 3, 1]]);
  assert.deepEqual(done.lines[0].done.map((row) => [row.load, row.reps, row.count]), [[100, 5, 2], [110, 2, 1]]);
  assert.deepEqual([open.status, open.loggedCount, open.lines[0].done], ["planned", 0, []]);

  // Today is the second day of week 2.
  assert.equal(blocks.weekOfBlock(block, today), 2);
  assert.equal(blocks.weekOfBlock(block, start), 1);
  assert.equal(blocks.weekOfBlock(block, addDays(start, -1)), null);
  assert.equal(blocks.weekOfBlock(block, addDays(start, 13)), 2);
  assert.equal(blocks.weekOfBlock(block, addDays(start, 14)), null);
  const current = (await blocks.currentBlock(today))!;
  assert.deepEqual([current.id, current.week, current.sessions, current.completed], [id, 2, 4, 1]);
  assert.equal(await blocks.currentBlock(addDays(start, 14)), null);
  assert.equal(await blocks.loadBlock(crypto.randomUUID()), null);
  assert.equal(await blocks.loadBlock("nope"), null);
});

test("a week can be added and taken off the end of a block", { skip }, async () => {
  await reset();
  const start = addDays(today, -14);
  const id = await blocks.createBlock({ title: "Grow", startDay: start, weeks: 1, layout: [{ offset: 0, templateId: legs }, { offset: 3, templateId: pull }] });
  await blocks.addBlockWeek(id, "5");
  await blocks.addBlockWeek(id, "");
  let block = (await blocks.loadBlock(id))!;
  assert.deepEqual(block.weekList.map((week) => week.sessions.map((session) => session.day)), [
    [start, addDays(start, 3)], [addDays(start, 7), addDays(start, 10)], [addDays(start, 14), addDays(start, 17)],
  ]);
  assert.deepEqual(block.weekList.map((week) => week.sessions[0].lines[0].planned[0].load), [100, 105, 105]);
  // A set planned without a load stays without one, whatever is added.
  assert.deepEqual(block.weekList.map((week) => week.sessions[1].lines[0].planned.map((row) => row.load)), [[5, null], [10, null], [10, null]]);
  // The repeat still knows which template it came from.
  const rows = await schema.rows("SELECT DISTINCT template_id FROM workouts WHERE block_id = $1 AND title = 'Legs'", [id]);
  assert.deepEqual(rows.map((row) => row.template_id), [legs]);

  await blocks.removeBlockWeek(id);
  block = (await blocks.loadBlock(id))!;
  assert.deepEqual([block.weeks, block.sessions], [2, 4]);

  // A week with a trained session stays.
  await train(block.weekList[1].sessions[0].id);
  await assert.rejects(blocks.removeBlockWeek(id), /Week 2 has a session you trained/);
  assert.equal((await blocks.loadBlock(id))!.weeks, 2);
  // The week after it repeats the plan, not what was done.
  await blocks.addBlockWeek(id, "2.5");
  block = (await blocks.loadBlock(id))!;
  assert.deepEqual(block.weekList[2].sessions.map((session) => [session.status, session.loggedCount]), [["planned", 0], ["planned", 0]]);
  assert.deepEqual(block.weekList[2].sessions[0].lines[0].planned.map((row) => [row.load, row.reps, row.count]), [[107.5, 5, 2], [117.5, 3, 1]]);

  await assert.rejects(blocks.addBlockWeek(id, "60"), WorkoutInputError);
  await assert.rejects(blocks.addBlockWeek(crypto.randomUUID(), "0"), /no longer exists/);
  await assert.rejects(blocks.removeBlockWeek(crypto.randomUUID()), /no longer exists/);

  const single = await blocks.createBlock({ title: "One", startDay: "2027-01-03", weeks: 1, layout: [{ offset: 0, templateId: legs }] });
  await assert.rejects(blocks.removeBlockWeek(single), /at least one week/);
  // The last week has nothing to repeat once its sessions are gone.
  await schema.rows("DELETE FROM workouts WHERE block_id = $1", [single]);
  await assert.rejects(blocks.addBlockWeek(single, "0"), /no sessions to repeat/);

  const full = await blocks.createBlock({ title: "Long", startDay: "2027-02-07", weeks: blocks.blockLimits.weeks, layout: [{ offset: 0, templateId: pull }] });
  await assert.rejects(blocks.addBlockWeek(full, "0"), /at most 16 weeks/);
});

test("a session can be added to a block on any day inside it", { skip }, async () => {
  await reset();
  const id = await blocks.createBlock({ title: "Fill", startDay: "2026-11-29", weeks: 2, layout: [{ offset: 0, templateId: legs }] });
  const extra = await blocks.addBlockSession(id, { day: "2026-12-10", templateId: pull });
  const empty = await blocks.addBlockSession(id, { day: "2026-12-05", templateId: "" });
  const block = (await blocks.loadBlock(id))!;
  assert.deepEqual(block.weekList.map((week) => week.sessions.map((session) => `${session.day} ${session.title}`)), [
    ["2026-11-29 Legs", "2026-12-05 Session"], ["2026-12-06 Legs", "2026-12-10 Pull"],
  ]);
  assert.deepEqual((await store.loadWorkout(extra))!.blocks[0].sets.map((set) => set.target.load), [5, null]);
  assert.deepEqual((await store.loadWorkout(empty))!.blocks, []);

  await assert.rejects(blocks.addBlockSession(id, { day: "2026-11-28" }), /runs from 29 Nov to 12 Dec/);
  await assert.rejects(blocks.addBlockSession(id, { day: "2026-12-13" }), WorkoutInputError);
  await assert.rejects(blocks.addBlockSession(id, { day: "soon" }), WorkoutInputError);
  await assert.rejects(blocks.addBlockSession(id, { day: "2026-12-01", templateId: crypto.randomUUID() }), /template no longer exists/);
  await assert.rejects(blocks.addBlockSession(id, { day: "2026-12-01", templateId: extra }), /template no longer exists/);
  await assert.rejects(blocks.addBlockSession(crypto.randomUUID(), { day: "2026-12-01" }), /block no longer exists/);
  assert.equal((await blocks.loadBlock(id))!.sessions, 4);
});

test("deleting a block keeps what was trained", { skip }, async () => {
  await reset();
  const id = await blocks.createBlock({ title: "Gone", startDay: addDays(today, -7), weeks: 2, layout: [{ offset: 0, templateId: legs }, { offset: 2, templateId: pull }] });
  const block = (await blocks.loadBlock(id))!;
  const trained = block.weekList[0].sessions[0].id;
  await train(trained);
  await blocks.renameBlock(id, " Kept name ", "  Deload in week two  ");
  assert.deepEqual((({ title, notes }) => [title, notes])((await blocks.loadBlock(id))!), ["Kept name", "Deload in week two"]);
  await assert.rejects(blocks.renameBlock(id, "", ""), WorkoutInputError);

  await blocks.deleteBlock(id);
  assert.equal(await blocks.loadBlock(id), null);
  const left = await schema.rows("SELECT id, status, block_id, block_week FROM workouts WHERE status <> 'template'");
  assert.deepEqual(left, [{ id: trained, status: "completed", block_id: null, block_week: null }]);
  assert.equal((await schema.rows("SELECT 1 FROM workouts WHERE status = 'template'")).length, 2);
  await blocks.deleteBlock(id);
  await blocks.deleteBlock("nope");
});

test("a pasted sheet becomes one block, a week for every stacked group", { skip }, async () => {
  await reset();
  const line = (...groups: Array<string[] | null>) => groups.flatMap((cells) => [...(cells ?? ["", "", "", ""]), "", ""]).join("\t");
  const sheet = [
    line(["Squat", "3", "5", "100"], ["Pull-ups", "3", "6-8", "bw+5kg"]),
    line(["Squat", "1", "3", "110"], ["Side planks", "1", "60", "each side"]),
    line(null, null),
    line(null, null),
    line(["2026-10-25", "", "", ""], ["2026-10-28", "", "", ""]),
    line(["Squat", "3", "6", "95"], ["Hip thrust", "2", "8", "RPE8"]),
  ].join("\n");
  const before = (await store.listExercises({ includeArchived: true })).length;

  const made = await blocks.importBlock(sheet, { title: "From the sheet", startDay: "2026-11-29" });
  assert.deepEqual([made.sessions, made.weeks, made.newExercises], [4, 2, ["Side planks", "Hip thrust"]]);
  const block = (await blocks.loadBlock(made.id))!;
  // The dated week trains three days apart; the week without dates borrows that.
  assert.deepEqual(block.weekList.map((week) => week.sessions.map((session) => `${session.day} ${session.title}`)), [
    ["2026-11-29 Squat", "2026-12-02 Pull-ups + Side planks"], ["2026-12-06 Squat", "2026-12-09 Hip thrust"],
  ]);
  assert.deepEqual(block.weekList[0].sessions[0].lines[0].planned.map((row) => [row.load, row.reps, row.count]), [[100, 5, 3], [110, 3, 1]]);
  // "Pull-ups" in the sheet is the library's "Pull-up": no second exercise.
  assert.equal(block.weekList[0].sessions[1].lines[0].exercise, "Pull-up");
  assert.equal((await store.listExercises({ includeArchived: true })).length, before + 2);

  const flipped = await blocks.importBlock(sheet, { title: "Newest on top", startDay: "2026-11-29", newestFirst: true });
  assert.deepEqual(flipped.newExercises, []);
  assert.deepEqual((await blocks.loadBlock(flipped.id))!.weekList.map((week) => week.sessions.map((session) => session.title)), [
    ["Squat", "Hip thrust"], ["Squat", "Pull-ups + Side planks"],
  ]);

  for (const bad of [
    () => blocks.importBlock("", { title: "A", startDay: "2026-11-29" }),
    () => blocks.importBlock(sheet, { title: "", startDay: "2026-11-29" }),
    () => blocks.importBlock(sheet, { title: "A", startDay: "29/11" }),
    () => blocks.importBlock("\t\t\n", { title: "A", startDay: "2026-11-29" }),
    () => blocks.importBlock(7, { title: "A", startDay: "2026-11-29" }),
  ]) await assert.rejects(bad(), WorkoutInputError);
  assert.equal((await blocks.listBlocks()).length, 2);
  assert.equal((await schema.rows("SELECT 1 FROM workouts WHERE status = 'planned' AND block_id IS NULL")).length, 0);
});

test("the desk keeps a week of a block either side of today", { skip }, async () => {
  await reset();
  const lone = await store.createWorkout({ status: "planned", title: "Far away", day: addDays(today, 40) });
  const id = await blocks.createBlock({
    title: "Long haul", startDay: addDays(today, -15), weeks: 6, layout: [{ offset: 0, templateId: legs }, { offset: 3, templateId: pull }],
  });
  // Sessions fall on days -15, -12, -8, -5, -1, 2, 6, 9, 13, 16, 20, 23 from today.
  const desk = await store.deskData();
  assert.deepEqual(desk.overdue.map((workout) => workout.day), [addDays(today, -1), addDays(today, -5)]);
  assert.deepEqual(desk.upcoming.map((workout) => workout.day), [addDays(today, 2), addDays(today, 6), addDays(today, 40)]);
  assert.deepEqual(desk.tucked, { ahead: 5, behind: 3 });
  assert.deepEqual(desk.upcoming.map((workout) => workout.block), [
    { id, title: "Long haul", week: 3 }, { id, title: "Long haul", week: 4 }, null,
  ]);
  assert.equal(desk.upcoming[2].id, lone);
  assert.deepEqual(desk.todayPlanned, []);
});
