import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberInput, parseRepsTarget } from "../app/(session)/admin/workouts/[id]/field-input";

const load = { max: 100000 };

test("numbers take a point or a comma", () => {
  assert.equal(parseNumberInput("97.5", load), 97.5);
  assert.equal(parseNumberInput("97,5", load), 97.5);
  assert.equal(parseNumberInput(" 100 ", load), 100);
  assert.equal(parseNumberInput("+10", load), 10);
  assert.equal(parseNumberInput("97.", load), 97);
  assert.equal(parseNumberInput(".5", load), 0.5);
});

test("empty is null, junk and out of range are invalid", () => {
  assert.equal(parseNumberInput("", load), null);
  assert.equal(parseNumberInput("abc", load), "invalid");
  assert.equal(parseNumberInput("1e3", load), "invalid");
  assert.equal(parseNumberInput("-5", load), "invalid");
  assert.equal(parseNumberInput("1.2.3", load), "invalid");
  assert.equal(parseNumberInput("100001", load), "invalid");
  assert.equal(parseNumberInput("11", { min: 1, max: 10 }), "invalid");
  assert.equal(parseNumberInput("0", { min: 1, max: 10 }), "invalid");
});

test("whole numbers only where asked", () => {
  assert.equal(parseNumberInput("5", { integer: true, max: 100 }), 5);
  assert.equal(parseNumberInput("5.5", { integer: true, max: 100 }), "invalid");
});

test("a rep target is one number or a rising range", () => {
  assert.deepEqual(parseRepsTarget("5"), { reps: 5, repsMax: null });
  assert.deepEqual(parseRepsTarget("8-12"), { reps: 8, repsMax: 12 });
  assert.deepEqual(parseRepsTarget("8–12"), { reps: 8, repsMax: 12 });
  assert.deepEqual(parseRepsTarget("8 - 12"), { reps: 8, repsMax: 12 });
  assert.deepEqual(parseRepsTarget("8-8"), { reps: 8, repsMax: null });
  assert.deepEqual(parseRepsTarget(""), { reps: null, repsMax: null });
});

test("a rep target that is not a number or does not rise is invalid", () => {
  for (const text of ["12-8", "8-", "-8", "a", "5.5", "5,5", "8-12-15", "20000", "5-20000"]) {
    assert.equal(parseRepsTarget(text), "invalid", text);
  }
});

import { fieldSpecs } from "../app/(session)/admin/workouts/[id]/specs";

test("kilometres are typed, metres are stored", () => {
  const [km] = fieldSpecs("distance_duration", false);
  assert.equal(km.codec.parse("5,2"), 5200);
  assert.equal(km.codec.format(5200), "5.2");
  assert.equal(km.codec.parse("abc"), "invalid");
  assert.equal(km.codec.parse(""), null);
});

test("a plan row reads and writes a rep range", () => {
  const [, reps] = fieldSpecs("weight_reps", true);
  const source = { reps: 8, repsMax: 12, load: null, rpe: null, duration: null, distance: null };
  assert.equal(reps.codec.format(reps.read(source)), "8–12");
  assert.deepEqual(reps.write(reps.codec.parse("5")), { reps: 5, repsMax: null });
});
