import assert from "node:assert/strict";
import test from "node:test";
import { starterExercises } from "../src/lib/starter-exercises";
import { EQUIPMENT, TRACKINGS } from "../src/lib/workout-doc";

test("starter exercise names are unique, ignoring case", () => {
  const names = starterExercises.map((exercise) => exercise.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("starter exercises use valid enums and name their muscles", () => {
  for (const exercise of starterExercises) {
    assert.ok(TRACKINGS.includes(exercise.tracking), exercise.name);
    assert.ok(EQUIPMENT.includes(exercise.equipment), exercise.name);
    assert.ok(exercise.primaryMuscle.length > 0, exercise.name);
    assert.ok(exercise.secondaryMuscles.length <= 8, exercise.name);
  }
});

test("barbell lifts record weight and reps", () => {
  const barbell = starterExercises.filter((exercise) => exercise.equipment === "barbell");
  assert.ok(barbell.length >= 6);
  for (const exercise of barbell) assert.equal(exercise.tracking, "weight_reps", exercise.name);
});

test("the pack is about thirty exercises", () => {
  assert.ok(starterExercises.length >= 28 && starterExercises.length <= 40);
});
