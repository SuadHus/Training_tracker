import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkoutInputError, collapseSets, exerciseMatches, exerciseMeta, formatDistance, formatDuration, formatSpan,
  formatTotal, isDay, isoWeek,
  noMeasures, parseWorkoutDraft, platesPerSide, setNotation, summarizeSets, topSet, weekStart,
  type FieldInfo, type Measures,
} from "../src/lib/workout-doc";

const squat = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";
const speed: FieldInfo = { id: "33333333-3333-4333-8333-333333333333", label: "Speed", unit: "km/h", kind: "decimal", exerciseId: run };
const tempo: FieldInfo = { id: "44444444-4444-4444-8444-444444444444", label: "Tempo", unit: "", kind: "text", exerciseId: null };
const now = new Date("2026-11-22T10:00:00Z");

const context = (status: "template" | "planned" | "completed" = "planned") => ({
  status, exerciseIds: new Set([squat, run]), fields: [speed, tempo], today: "2026-11-22", now,
});

function draft(overrides: Record<string, unknown> = {}, set: Record<string, unknown> = {}) {
  return {
    title: "  Legs  ",
    day: "2026-11-22",
    notes: " heavy ",
    blocks: [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      exerciseId: squat,
      notes: "",
      restSeconds: 180,
      sets: [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        warmup: false,
        target: { reps: 5, load: 100, repsMax: 8 },
        actual: { reps: 5, load: 100 },
        custom: {},
        loggedAt: "2026-11-22T09:00:00.000Z",
        ...set,
      }],
    }],
    ...overrides,
  };
}

const firstSet = (value: ReturnType<typeof parseWorkoutDraft>) => value.blocks[0].sets[0];

test("a good draft is accepted and trimmed", () => {
  const parsed = parseWorkoutDraft(draft(), context());
  assert.equal(parsed.title, "Legs");
  assert.equal(parsed.notes, "heavy");
  assert.equal(parsed.day, "2026-11-22");
  assert.deepEqual(firstSet(parsed).target, { reps: 5, load: 100, rpe: null, duration: null, distance: null, repsMax: 8 });
  assert.equal(firstSet(parsed).actual.reps, 5);
  assert.equal(firstSet(parsed).loggedAt, "2026-11-22T09:00:00.000Z");
});

test("custom values for unknown fields and for fields scoped to another exercise are dropped", () => {
  const unknown = "55555555-5555-4555-8555-555555555555";
  const parsed = parseWorkoutDraft(
    draft({}, { custom: { [speed.id]: 12, [tempo.id]: " 3-1-1 ", [unknown]: 4 } }), context(),
  );
  assert.deepEqual(firstSet(parsed).custom, { [tempo.id]: "3-1-1" });
});

test("a template keeps targets and strips actuals, custom values and logging", () => {
  const parsed = parseWorkoutDraft(draft({ day: "2026-01-01" }, { custom: { [tempo.id]: "x" } }), context("template"));
  assert.equal(parsed.day, null);
  assert.deepEqual(firstSet(parsed).actual, noMeasures);
  assert.deepEqual(firstSet(parsed).custom, {});
  assert.equal(firstSet(parsed).loggedAt, null);
  assert.equal(firstSet(parsed).target.load, 100);
});

test("duplicate ids are rejected", () => {
  const twice = draft();
  twice.blocks.push({ ...twice.blocks[0], sets: [] });
  assert.throws(() => parseWorkoutDraft(twice, context()), WorkoutInputError);
  const sharedSet = draft();
  sharedSet.blocks.push({ ...sharedSet.blocks[0], id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  assert.throws(() => parseWorkoutDraft(sharedSet, context()), WorkoutInputError);
});

test("an unknown exercise is rejected", () => {
  const bad = draft();
  bad.blocks[0].exerciseId = "99999999-9999-4999-8999-999999999999";
  assert.throws(() => parseWorkoutDraft(bad, context()), /no longer in the library/);
});

test("a bad day is rejected, and a completed session cannot be dated in the future", () => {
  assert.throws(() => parseWorkoutDraft(draft({ day: "2026-02-30" }), context()), /valid date/);
  assert.throws(() => parseWorkoutDraft(draft({ day: "2026-11-23" }), context("completed")), /today or earlier/);
  assert.equal(parseWorkoutDraft(draft({ day: "2026-11-23" }), context("planned")).day, "2026-11-23");
});

test("a logged set without a result is rejected", () => {
  assert.throws(() => parseWorkoutDraft(draft({}, { actual: { load: 100 } }), context()), /records nothing/);
});

test("a completed session needs a logged set", () => {
  assert.throws(() => parseWorkoutDraft(draft({}, { loggedAt: null }), context("completed")), /at least one logged set/);
});

test("too many sets in one exercise are rejected", () => {
  const many = draft();
  many.blocks[0].sets = Array.from({ length: 31 }, (_, index) => ({
    ...many.blocks[0].sets[0], id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
  }));
  assert.throws(() => parseWorkoutDraft(many, context()), /at most 30 sets/);
});

test("a rep range whose top is not above the bottom becomes a plain target", () => {
  assert.equal(firstSet(parseWorkoutDraft(draft({}, { target: { reps: 5, repsMax: 5 } }), context())).target.repsMax, null);
  assert.equal(firstSet(parseWorkoutDraft(draft({}, { target: { reps: 8, repsMax: 5 } }), context())).target.repsMax, null);
  assert.equal(firstSet(parseWorkoutDraft(draft({}, { target: { repsMax: 8 } }), context())).target.repsMax, null);
});

test("a logging time in the future is clamped to now", () => {
  const parsed = parseWorkoutDraft(draft({}, { loggedAt: "2030-01-01T00:00:00Z" }), context());
  assert.ok(new Date(firstSet(parsed).loggedAt!).valueOf() <= now.valueOf() + 5 * 60_000);
});

test("plates per side are built from pairs, heaviest first", () => {
  assert.deepEqual(platesPerSide(140), [25, 25, 10]);
  assert.deepEqual(platesPerSide(97.5), [25, 10, 2.5, 1.25]);
  assert.deepEqual(platesPerSide(180), [25, 25, 25, 5]);
  assert.deepEqual(platesPerSide(20), []);
  assert.equal(platesPerSide(19), null);
  assert.equal(platesPerSide(21), null);
  assert.deepEqual(platesPerSide(25, 15), [5]);
});

test("ISO weeks follow the Thursday rule", () => {
  assert.deepEqual(isoWeek("2026-11-22"), { year: 2026, week: 47 });
  assert.deepEqual(isoWeek("2026-12-31"), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek("2027-01-03"), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek("2027-01-04"), { year: 2027, week: 1 });
  assert.deepEqual(isoWeek("2024-12-30"), { year: 2025, week: 1 });
});

test("a week starts on Monday", () => {
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(weekStart("2027-01-03"), "2026-12-28");
});

const measures = (overrides: Partial<Measures>): Measures => ({ ...noMeasures, ...overrides });

test("sets are written the way lifters write them", () => {
  assert.equal(setNotation(measures({ reps: 5, load: 140 })), "140 × 5");
  assert.equal(setNotation(measures({ reps: 8 })), "× 8");
  assert.equal(setNotation(measures({ reps: 6, load: 10 }), "bodyweight_reps"), "+10 × 6");
  assert.equal(setNotation(measures({ reps: 6, load: 0 }), "bodyweight_reps"), "× 6");
  assert.equal(setNotation(measures({ duration: 60 })), "1:00");
  assert.equal(setNotation(measures({ distance: 5200, duration: 1890 })), "5.2 km in 31:30");
  assert.equal(setNotation(measures({})), "");
});

test("durations, distances and totals are formatted for reading", () => {
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(90), "1:30");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDistance(400), "400 m");
  assert.equal(formatDistance(5200), "5.2 km");
  assert.equal(formatTotal(34250), "34\u2009250");
  assert.deepEqual([58, 60, 64, 120].map(formatSpan), ["58 min", "1 h", "1 h 4 min", "2 h"]);
});

const logged = (warmup: boolean, reps: number | null, load: number | null, rpe: number | null = null) => ({
  warmup, measures: measures({ reps, load, rpe }), actual: measures({ reps, load, rpe }), loggedAt: "2026-11-22T09:00:00Z",
});

test("neighbouring identical sets collapse into one run and a mixed RPE is dropped", () => {
  const runs = collapseSets([logged(true, 5, 60), logged(false, 5, 100, 7), logged(false, 5, 100, 8), logged(false, 5, 105)]);
  assert.equal(runs.length, 3);
  assert.equal(runs[1].count, 2);
  assert.equal(runs[1].measures.rpe, null);
  assert.equal(runs[0].warmup, true);
});

test("the top set is the heaviest logged working set, ties broken by reps", () => {
  const sets = [logged(true, 5, 200), logged(false, 5, 100), logged(false, 8, 100), logged(false, 3, 90)];
  assert.equal(topSet(sets), sets[2]);
  assert.equal(topSet([{ ...logged(false, 5, 100), loggedAt: null }]), null);
  assert.equal(topSet([]), null);
});

test("totals skip warm-ups and unlogged sets", () => {
  const sets = [logged(true, 10, 20), logged(false, 5, 100, 8), logged(false, 8, null, 6), { ...logged(false, 5, 100), loggedAt: null }];
  assert.deepEqual(summarizeSets(sets), { workSets: 2, volume: 500, averageRpe: 7 });
});

test("a NUL character in any text is an input error, not a database error", () => {
  const bad = "a\u0000b";
  assert.throws(() => parseWorkoutDraft(draft({ title: bad }), context()), WorkoutInputError);
  assert.throws(() => parseWorkoutDraft(draft({ notes: bad }), context()), WorkoutInputError);
  const block = draft().blocks[0];
  assert.throws(() => parseWorkoutDraft(draft({ blocks: [{ ...block, notes: bad }] }), context()), WorkoutInputError);
  assert.throws(() => parseWorkoutDraft(draft({}, { custom: { [tempo.id]: bad } }), context()), WorkoutInputError);
});

test("a logging time before the year 2000 is rejected, including ones the database cannot store", () => {
  for (const loggedAt of ["0001-01-01T00:00:00Z", "-271821-04-20T00:00:00Z", "1999-12-31T23:59:59Z"]) {
    assert.throws(() => parseWorkoutDraft(draft({}, { loggedAt }), context()), WorkoutInputError, loggedAt);
  }
  assert.equal(firstSet(parseWorkoutDraft(draft({}, { loggedAt: "2000-01-01T00:00:00Z" }), context())).loggedAt, "2000-01-01T00:00:00.000Z");
});

test("a search finds an exercise by its name or by the start of a muscle or equipment word", () => {
  const chin = { name: "Chin-up", equipment: "bodyweight" as const, primaryMuscle: "Back", secondaryMuscles: ["Biceps"] };
  const press = { name: "Leg press", equipment: "machine" as const, primaryMuscle: "Quads", secondaryMuscles: ["Glutes"] };
  assert.equal(exerciseMatches(chin, "chin"), true);
  assert.equal(exerciseMatches(press, "chin"), false, "the middle of Machine is not a match");
  assert.equal(exerciseMatches(press, "mach"), true);
  assert.equal(exerciseMatches(press, "  PRESS glu "), true);
  assert.equal(exerciseMatches(chin, "bic back"), true);
  assert.equal(exerciseMatches(chin, "back squat"), false);
  assert.equal(exerciseMatches(chin, ""), true);
});

test("the line under an exercise name leaves out equipment that says nothing", () => {
  assert.equal(exerciseMeta({ equipment: "barbell", primaryMuscle: "Quads" }), "Barbell, Quads");
  assert.equal(exerciseMeta({ equipment: "other", primaryMuscle: "Core" }), "Core");
});

test("only real ISO calendar days are accepted", () => {
  assert.equal(isDay("2024-02-29"), true);
  assert.equal(isDay("2026-02-29"), false);
  assert.equal(isDay("2026-1-02"), false);
  assert.equal(isDay("0000-01-01"), false);
  assert.equal(isDay(20260101), false);
});
