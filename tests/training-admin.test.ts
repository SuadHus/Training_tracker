import assert from "node:assert/strict";
import test from "node:test";
import { moveExerciseGroup, parseDate, parseTypedFields, readActualSet, workoutDate } from "../src/lib/training-admin";

const weight = { id: "speed", label: "Bar speed", kind: "decimal" as const };
const technique = { id: "comment", label: "Technique", kind: "text" as const };

test("additional fields preserve zero, omit blanks, and ignore out-of-scope fields", () => {
  const form = new FormData();
  form.set("custom_speed", "0");
  form.set("custom_comment", " ");
  form.set("custom_unknown", "unexpected");
  assert.deepEqual(parseTypedFields(form, [weight, technique]), { speed: 0 });
});

test("actual sets include unloaded reps and timed work without inventing a load", () => {
  const form = new FormData();
  form.set("reps", "12");
  assert.deepEqual(readActualSet(form, []), { reps: 12, load: null, rpe: null, duration: null, distance: null, values: {} });
  form.delete("reps");
  form.set("custom_speed", "2.45");
  assert.deepEqual(readActualSet(form, [weight]), {
    reps: null,
    load: null,
    rpe: null,
    duration: null,
    distance: null,
    values: { speed: 2.45 },
  });
  assert.throws(() => readActualSet(new FormData(), []), /custom measurement/i);
});

test("an impossible date is rejected before reaching PostgreSQL", () => {
  assert.equal(parseDate("2028-02-29"), "2028-02-29");
  assert.throws(() => parseDate("2026-02-29"), /date/i);
});

test("moving an exercise block preserves set order and separates nonadjacent blocks", () => {
  const rows = [
    { id: "a1", exercise_id: "a" },
    { id: "a2", exercise_id: "a" },
    { id: "b1", exercise_id: "b" },
    { id: "c1", exercise_id: "c" },
    { id: "a3", exercise_id: "a" },
  ];
  assert.deepEqual(moveExerciseGroup(rows, "b1", "up", "a1").map(({ id }) => id), ["b1", "a1", "a2", "c1", "a3"]);
  assert.deepEqual(moveExerciseGroup(rows, "b1", "down", "c1").map(({ id }) => id), ["a1", "a2", "c1", "b1", "a3"]);
  assert.equal(moveExerciseGroup(rows, "a1", "up", null), rows);
  assert.throws(() => moveExerciseGroup(rows, "a2", "down", "b1"), /block/i);
});

test("starting today uses Stockholm's date at the time of submission", () => {
  const form = new FormData();
  const now = new Date("2026-08-16T22:30:00Z");
  form.set("timing", "today");
  form.set("local_day", "2026-08-16");
  assert.equal(workoutDate(form, now), "2026-08-17");
  form.delete("timing");
  assert.equal(workoutDate(form, now), "2026-08-16");
});

test("a move request can only swap with the rendered neighboring exercise", () => {
  const rows = [
    { id: "a", exercise_id: "squat" },
    { id: "b", exercise_id: "row" },
    { id: "c", exercise_id: "press" },
  ];
  const moved = moveExerciseGroup(rows, "c", "up", "b");
  assert.deepEqual(moved.map(({ id }) => id), ["a", "c", "b"]);
  assert.equal(moveExerciseGroup(moved, "c", "up", "b"), moved);
});
