// What the home page draws of a week and where: the lifter's lifts, the heaviest bar when there is no main lift, and which session
// rows keep a small bar of their own. Plain objects, no database and no markup.
import assert from "node:assert/strict";
import test from "node:test";
import { barBeside, heaviestBar, shownAbove, stageLifts } from "../src/lib/week-bars";
import type { Equipment, Measures } from "../src/lib/workout-doc";

type Block = { exercise: { name: string; equipment: Equipment; barKg: number | null }; top: Measures | null };
type Session = { id: string; day: string; blocks: Block[] };

const block = (name: string, load: number | null, reps: number | null, more: Partial<Block["exercise"]> & { rpe?: number } = {}): Block => {
  const { rpe = null, ...exercise } = more;
  return {
    exercise: { name, equipment: "barbell", barKg: null, ...exercise },
    top: load === null && reps === null ? null : { load, reps, rpe, duration: null, distance: null },
  };
};
const session = (id: string, day: string, ...blocks: Block[]): Session => ({ id, day, blocks });
const week = (...sessions: Session[]) => ({ sessions });

const SQUAT = block("Low bar squat", 180, 3, { rpe: 8.5 });
const BENCH = block("Bench press", 100, 5);
const PAUSED_ROW = block("Pendlay row", 90, 5);
const mon = session("mon", "2026-11-23", SQUAT, PAUSED_ROW);
const wed = session("wed", "2026-11-25", BENCH);

test("every main lift is drawn above the sessions, and the sessions beside them draw no second bar for it", () => {
  const shown = shownAbove(week(mon, wed));
  assert.deepEqual([...shown], [SQUAT, BENCH]);
  assert.equal(barBeside(wed, shown), undefined, "the bench press of Wednesday is the stage's");
});

test("a barbell block that is not a main lift keeps its small bar beside its session", () => {
  const shown = shownAbove(week(mon, wed));
  assert.equal(barBeside(mon, shown), PAUSED_ROW, "the squat is skipped, the row is not");
});

test("without a stage, a session draws the first bar it can", () => {
  assert.equal(barBeside(mon), SQUAT);
  assert.equal(barBeside(session("sun", "2026-11-29", block("Cable fly", 40, 12, { equipment: "cable" }))), undefined);
});

test("a week with no main lift shows its heaviest bar above the sessions, and that session draws no second one", () => {
  const rows = week(
    session("mon", "2026-11-23", block("Pendlay row", 90, 5), block("Hip thrust", 140, 8)),
    session("thu", "2026-11-26", block("Barbell curl", 40, 10)),
  );
  assert.deepEqual(stageLifts(rows), []);
  const found = heaviestBar(rows);
  assert.equal(found?.block, rows.sessions[0].blocks[1]);
  assert.equal(found?.session.id, "mon");
  assert.deepEqual([...shownAbove(rows)], [rows.sessions[0].blocks[1]]);
  assert.equal(barBeside(rows.sessions[0], shownAbove(rows)), rows.sessions[0].blocks[0], "the other block of the session keeps its bar");
});

test("the heaviest bar skips what plates cannot make, other equipment and sets without a load; equal loads go to the more reps", () => {
  assert.equal(heaviestBar(week()), null);
  assert.equal(heaviestBar(week(session("mon", "2026-11-23",
    block("Pendlay row", 61, 5), block("Row", 140, 5, { equipment: "machine" }), block("Curl", null, 10), block("Curl", 10, 10),
  ))), null);
  const eight = block("Hip thrust", 140, 8), ten = block("Hip thrust", 140, 10);
  assert.equal(heaviestBar(week(session("mon", "2026-11-23", eight), session("fri", "2026-11-27", ten)))?.block, ten);
  assert.equal(heaviestBar(week(session("mon", "2026-11-23", ten), session("fri", "2026-11-27", eight)))?.block, ten);
});

test("a week with nothing to draw shows nothing above its sessions", () => {
  assert.deepEqual([...shownAbove(week())], []);
  assert.deepEqual([...shownAbove(week(session("mon", "2026-11-23", block("Leg press", 220, 10, { equipment: "machine" }))))], []);
});

test("the stage gets each main lift with its own exercise name, load, reps, RPE and day, heaviest first", () => {
  assert.deepEqual(stageLifts(week(mon, wed)), [
    { kind: "squat-low", exercise: "Low bar squat", loadKg: 180, barKg: 20, reps: 3, rpe: 8.5, day: "Mon 23 Nov" },
    { kind: "bench", exercise: "Bench press", loadKg: 100, barKg: 20, reps: 5, rpe: null, day: "Wed 25 Nov" },
  ]);
});

test("one main lift gives a stage of one lift", () => {
  assert.deepEqual(stageLifts(week(wed)).map((lift) => lift.kind), ["bench"]);
});

test("the bar of the exercise reaches the stage: a 15 kg bar stays 15, and no bar is the standard 20", () => {
  const lifts = stageLifts(week(session("mon", "2026-11-23", block("Bench press", 17.5, 6, { barKg: 15 }), block("Deadlift", 100, 5))));
  assert.deepEqual(lifts.map((lift) => [lift.kind, lift.loadKg, lift.barKg]), [["deadlift-conventional", 100, 20], ["bench", 17.5, 15]]);
});

test("a lift the stage cannot play is not on it: no reps, or a load the plates cannot make; its bar may still be the heaviest one", () => {
  const odd = block("Low bar squat", 61, 5), none = block("Bench press", 100, null);
  const rows = week(session("mon", "2026-11-23", odd, none));
  assert.deepEqual(stageLifts(rows), []);
  assert.deepEqual([...shownAbove(rows)], [none], "the bench press has a load to draw as plates, the squat has not");
});
