// The words and counters of the row around the stage: what a screen reader is told, how the plates are written and what the rep counter says.
import assert from "node:assert/strict";
import test from "node:test";
import { perSide } from "../app/ui/bar-load";
import { altText, counterOf, countedPlates, drawnReps, LONG_STACK, MAX_SQUARES, platesOf, shortName, squareClasses, type MainLift } from "../src/lib/lift-row";
import { LIFT_KINDS, MAX_DRAWN_REPS } from "../src/lib/lifts";
import { platesPerSide } from "../src/lib/workout-doc";

const lift = (over: Partial<MainLift> = {}): MainLift => ({ kind: "squat-low", exercise: "Low-bar squat", loadKg: 182.5, barKg: 20, reps: 3, rpe: 8.5, day: "Mon 23 Nov", ...over });

test("the sentence for the drawing names the lift, the load, the reps and the plates, and is plain text", () => {
  const text = altText(lift(), platesPerSide(182.5)!, 3);
  assert.match(text, /^Low-bar squat, 182.5 kilograms for 3 reps\. 25, 25, 25, 5, 1.25 kilograms on each side\. /);
  assert.match(altText(lift({ loadKg: 20, reps: 1 }), [], 1), /^Low-bar squat, 20 kilograms for 1 rep\. The empty bar\. /);
  assert.match(altText(lift({ exercise: "" }), [25], 1), /^Low bar squat, /, "the app's own name when the exercise has none");
});

test("every lift tells how it starts and what sets it apart, and has a short name for a phone", () => {
  for (const kind of LIFT_KINDS) {
    assert.match(altText(lift({ kind }), [25], 1), /\. (It starts in the (rack|hooks)|The bar starts on the floor)/, kind);
    assert.ok(shortName(kind).length > 0 && shortName(kind).length <= 10, kind);
  }
  assert.equal(new Set(LIFT_KINDS.map(shortName)).size, 6, "no two tabs say the same");
});

test("plates the stage draws are the plates of the load, and a load the plates cannot make is not drawn", () => {
  assert.deepEqual(platesOf(lift()), [25, 25, 25, 5, 1.25]);
  assert.deepEqual(platesOf(lift({ loadKg: 20 })), []);
  assert.deepEqual(platesOf(lift({ loadKg: 180, barKg: 15 })), platesPerSide(180, 15));
  assert.throws(() => platesOf(lift({ loadKg: 61 })));
  assert.throws(() => platesOf(lift({ loadKg: 5000 })));
});

test("the reps drawn are the set's, at least one and at most as many as the model can do", () => {
  assert.deepEqual([0, 1, 2.4, 8, 30, 31, 400].map((reps) => drawnReps(lift({ reps }))), [1, 1, 2, 8, 30, MAX_DRAWN_REPS, MAX_DRAWN_REPS]);
});

test("a long sleeve is written as counts, a short one as the site writes it under every bar", () => {
  assert.equal(countedPlates(platesPerSide(820)!), "16 × 25");
  assert.equal(countedPlates(platesPerSide(20 + 2 * (9 * 25 + 22.5 + 1.25))!), "9 × 25 + 20 + 2.5 + 1.25");
  assert.equal(countedPlates([25, 10]), "25 + 10");
  assert.equal(LONG_STACK, 6);
  assert.equal(perSide(300), "25 + 25 + 25 + 25 + 25 + 15");
});

test("the plate line is as long for every load: never more than the worst case the stylesheet reserves room for", () => {
  for (const load of [20, 60, 102.5, 182.5, 300, 820, 20 + 2 * (9 * 25 + 22.5 + 1.25), 20 + 2 * (11 * 25 + 21.25)]) {
    const plates = platesPerSide(load)!;
    const line = plates.length > LONG_STACK ? countedPlates(plates) : perSide(load)!;
    assert.ok(line.length <= 28, `${load} kg: the plate line is ${line.length} characters`);
  }
});

test("the counter shows the rep under way, the next one between reps, and every rep done once the set is finished", () => {
  assert.deepEqual(counterOf(8, { rep: 3, done: 2 }, "descent", false), { shown: 3, done: 2, total: 8, phase: "descent" });
  assert.deepEqual(counterOf(8, { rep: 0, done: 2 }, "walk in", false), { shown: 3, done: 2, total: 8, phase: "walk in" });
  assert.deepEqual(counterOf(8, { rep: 0, done: 8 }, "rack", false), { shown: 8, done: 8, total: 8, phase: "rack" });
  assert.deepEqual(counterOf(8, { rep: 1, done: 0 }, "pull", true), { shown: 8, done: 8, total: 8, phase: "done" });
  assert.deepEqual(squareClasses(counterOf(3, { rep: 2, done: 1 }, "", false)), ["done", "now", ""]);
  assert.equal(MAX_SQUARES, 10, "ten squares fit the foot of the stage on a phone 320 px wide");
  assert.equal(squareClasses(counterOf(MAX_SQUARES, { rep: 2, done: 1 }, "", false)).length, MAX_SQUARES, "a set of the most the row can hold has a square for each rep");
  for (const total of [MAX_SQUARES + 1, 12, 30]) {
    assert.deepEqual(squareClasses(counterOf(total, { rep: 2, done: 1 }, "", false)), [], `${total} reps: no row, because a row that stopped short would look finished`);
  }
});
