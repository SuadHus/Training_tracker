import assert from "node:assert/strict";
import test from "node:test";
import { LIFT_KINDS, MAX_DRAWN_REPS, liftKind, liftNames, topLifts, type LiftKind } from "../src/lib/lifts";
import type { Equipment, Measures } from "../src/lib/workout-doc";

const kindOf = (name: string, equipment: Equipment = "barbell") => liftKind({ name, equipment });

function each(kind: LiftKind | null, names: string[]) {
  for (const name of names) assert.equal(kindOf(name), kind, name);
}

test("there are six animated lifts and each has a name", () => {
  assert.equal(LIFT_KINDS.length, 6);
  for (const kind of LIFT_KINDS) assert.ok(liftNames[kind].length > 0, kind);
});

test("the name of each animated lift is recognised as that lift", () => {
  for (const kind of LIFT_KINDS) assert.equal(kindOf(liftNames[kind]), kind, liftNames[kind]);
});

test("squats: the bar position decides, written any usual way", () => {
  each("squat-low", [
    "Low bar squat", "Low-bar squat", "low bar back squat", "Squat (low bar)", "Lowbar squat", "LOW BAR SQUAT", "Low-bar squats", "LBBS",
  ]);
  each("squat-high", [
    "High bar squat", "High-bar squat", "High bar back squat", "Squat, high bar", "Highbar squat", "HBBS",
  ]);
});

test("a squat that does not say where the bar sits is drawn as a high bar squat", () => {
  each("squat-high", ["Squat", "Back squat", "Barbell squat", "Barbell back squat", "Squats"]);
});

test("bench press: close grip is its own lift", () => {
  each("bench", ["Bench press", "Bench", "Barbell bench press", "Flat bench press", "bench presses"]);
  each("bench-close", [
    "Close grip bench press", "Close-grip bench press", "Close grip bench", "Closegrip bench press", "Narrow grip bench press",
    "Bench press, close grip", "CGBP",
  ]);
});

test("deadlift: conventional unless it says sumo", () => {
  each("deadlift-conventional", ["Deadlift", "Conventional deadlift", "Barbell deadlift", "Deadlifts", "Conventional DL"]);
  each("deadlift-sumo", ["Sumo deadlift", "sumo deadlifts", "Deadlift (sumo)", "Sumo DL"]);
});

test("words that do not change the picture are let through", () => {
  each("squat-low", ["Paused low bar squat", "Competition low-bar squat", "Tempo low bar squat", "Low bar squat, beltless", "Comp squat low bar"]);
  each("bench", ["Paused bench press", "Competition bench", "Touch and go bench press", "Bench press TnG", "Bench press 2ct pause", "Comp bench"]);
  each("bench-close", ["Paused close grip bench press"]);
  each("deadlift-sumo", ["Competition sumo deadlift", "Paused sumo deadlift"]);
  each("deadlift-conventional", ["Paused deadlift", "Heavy deadlift"]);
});

test("another lift is never drawn as one of the six", () => {
  each(null, [
    // other squats
    "Front squat", "Overhead squat", "Zercher squat", "Box squat", "Pin squat", "Safety bar squat", "SSB squat", "Hack squat",
    "Split squat", "Bulgarian split squat", "Goblet squat", "Sumo squat", "Wide stance squat", "Belt squat", "Jump squat", "Half squat",
    // other presses
    "Incline bench press", "Decline bench press", "Floor press", "Board press", "Pin press", "Larsen press", "Spoto press",
    "Feet up bench press", "Reverse grip bench press", "Wide grip bench press", "Overhead press", "Push press", "Bench dip", "Bench pull",
    // other pulls
    "Romanian deadlift", "RDL", "Stiff-leg deadlift", "Stiff legged deadlift", "Straight leg deadlift", "Deficit deadlift",
    "Block pull", "Rack pull", "Trap bar deadlift", "Hex bar deadlift", "Snatch grip deadlift", "Single-leg deadlift", "Semi-sumo deadlift",
    "Deadlift from blocks", "Suitcase deadlift", "Jefferson deadlift", "Sumo", "Sumo stance good morning",
    // not lifts at all
    "", "   ", "Barbell row", "Hip thrust", "Good morning", "Bicep curls", "Leg press",
  ]);
});

test("a count or tempo is let through, but a fraction or a decimal, which names another movement, is not drawn", () => {
  each("squat-high", ["Squat 3s", "Squat 5x5", "3 sec paused squat"]);
  each(null, [
    "1 1/2 squat", "1 1/4 squat", "Squat 1.5", "Bench 1 1/4", "Deadlift 1 1/2", "Bench press 1 / 2", "Squat 1\u00bd", "Squat \u00be", "Squat 3/1/1",
  ]);
});

test("a name that asks for two lifts at once is not drawn", () => {
  each(null, ["Low bar high bar squat", "Sumo conventional deadlift", "Squat and bench", "Bench deadlift", "Squat deadlift"]);
});

test("only a barbell exercise is drawn", () => {
  for (const equipment of ["dumbbell", "machine", "cable", "kettlebell", "bodyweight", "other"] as const) {
    assert.equal(kindOf("Bench press", equipment), null, equipment);
    assert.equal(kindOf("Squat", equipment), null, equipment);
    assert.equal(kindOf("Sumo deadlift", equipment), null, equipment);
  }
});

// The week's top sets -----------------------------------------------------------

type Block = { exercise: { name: string; equipment: Equipment; barKg: number | null }; top: Measures | null };
const block = (name: string, load: number | null, reps: number | null, more: Partial<Block["exercise"]> = {}): Block => ({
  exercise: { name, equipment: "barbell", barKg: null, ...more },
  top: load === null && reps === null ? null : { load, reps, rpe: null, duration: null, distance: null },
});
const session = (id: string, ...blocks: Block[]) => ({ id, blocks });
const told = (lifts: ReturnType<typeof topLifts<Block, ReturnType<typeof session>>>) =>
  lifts.map((lift) => `${lift.kind} ${lift.load}x${lift.reps} ${lift.session.id}`);

test("a week's lifts are the heaviest working set of each lift, heaviest first", () => {
  const week = [
    session("mon", block("Low bar squat", 180, 3), block("Romanian deadlift", 120, 8), block("Leg press", 220, 10, { equipment: "machine" })),
    session("wed", block("Bench press", 100, 5), block("Close grip bench press", 85, 8)),
    session("fri", block("Sumo deadlift", 220, 2), block("Low bar squat", 182.5, 1), block("Paused bench press", 102.5, 3)),
  ];
  assert.deepEqual(told(topLifts(week)), [
    "deadlift-sumo 220x2 fri", "squat-low 182.5x1 fri", "bench 102.5x3 fri", "bench-close 85x8 wed",
  ]);
});

test("equal loads are told apart by reps, and the earlier session wins an exact tie", () => {
  assert.deepEqual(told(topLifts([
    session("mon", block("Deadlift", 200, 3)), session("wed", block("Deadlift", 200, 5)), session("fri", block("Deadlift", 200, 5)),
  ])), ["deadlift-conventional 200x5 wed"]);
});

test("lifts of the same weight keep the order squat, bench, deadlift", () => {
  assert.deepEqual(told(topLifts([
    session("mon", block("Sumo deadlift", 100, 5), block("Bench press", 100, 5), block("High bar squat", 100, 5)),
  ])), ["squat-high 100x5 mon", "bench 100x5 mon", "deadlift-sumo 100x5 mon"]);
});

test("a set that cannot be drawn truthfully is left out", () => {
  assert.deepEqual(told(topLifts([session("mon",
    block("Front squat", 110, 5),                               // another lift
    block("Bench press", 100, 5, { equipment: "dumbbell" }),    // not a barbell
    block("Deadlift", null, null),                              // nothing logged
    block("Deadlift", 180, null),                               // no reps
    block("Low bar squat", 15, 5),                              // lighter than the bar
    block("High bar squat", 61, 5),                             // cannot be made from plates
    block("Close grip bench press", 60, 0),                     // no rep was made
    block("Sumo deadlift", 60, MAX_DRAWN_REPS + 1),             // longer than anyone would watch
  )])), []);
});

test("the bar of the exercise decides whether a load can be made", () => {
  // 17.5 kg is a 15 kg bar with 1.25 a side, and less than a standard bar.
  assert.deepEqual(told(topLifts([session("mon", block("Bench press", 17.5, 6, { barKg: 15 }), block("Deadlift", 17.5, 6))])), ["bench 17.5x6 mon"]);
  assert.deepEqual(told(topLifts([session("mon", block("Bench press", 20, MAX_DRAWN_REPS))])), [`bench 20x${MAX_DRAWN_REPS} mon`]);
});

test("a week without any of the six lifts has no lifts", () => {
  assert.deepEqual(topLifts([]), []);
  assert.deepEqual(topLifts([session("mon", block("Hip thrust", 140, 8), block("Barbell row", 80, 8))]), []);
});
