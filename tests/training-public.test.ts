import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWorkout, valueForField, validDay } from "../src/lib/training-public";

test("work totals omit warm-ups and count unloaded sets separately from tonnage", () => {
  assert.deepEqual(summarizeWorkout([
    { reps: 10, loadKg: 20, warmup: true, rpe: null, primaryMuscle: "Legs" },
    { reps: 5, loadKg: 100, warmup: false, rpe: 8, primaryMuscle: "Legs" },
    { reps: 8, loadKg: null, warmup: false, rpe: 6, primaryMuscle: "Back" },
  ]), { workSets: 2, tonnage: 500, averageRpe: 7, muscles: { Legs: 1, Back: 1 } });
});

test("custom fields retain zero and have no placeholder measurement", () => {
  assert.equal(valueForField({ speed: 0 }, "speed", "m/s"), "0 m/s");
  assert.equal(valueForField({}, "speed", "m/s"), null);
});

test("only real ISO calendar days are accepted", () => {
  assert.equal(validDay("2024-02-29"), true);
  assert.equal(validDay("2026-02-29"), false);
  assert.equal(validDay("2026-1-02"), false);
  assert.equal(validDay("0000-01-01"), false);
});
