import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDraft, guessExercise, parseSheet, planBlock, readSheet, rowLabel, sessionName, sheetKey, sheetLimits, suggestStart,
  suggestTitle, tidyName, usualWeekdays, type SheetEntry,
} from "../src/lib/sheet-import";

// Two workouts side by side, then a dated week of two under them, as a spreadsheet copies them.
const line = (...groups: Array<string[] | null>) => groups.flatMap((cells) => [...(cells ?? ["", "", "", ""]), "", ""]).join("\t");
const sheet = [
  line(["Squat", "3", "5", "100"], ["Deadlift ", "1", "4", "120"]),
  line(["Bench press ", "2", "2", "80"], ["Deadlift ", "1", "1", "140"]),
  line(["Bench press ", "1", "1", "90"], ["Pullups", "3", "7", "bw"]),
  line(["Bench press ", "4", "4", "85"], ["Biceps ", "1", "6-8", "RPE10"]),
  line(["Single leg press", "1+2R", "8", "RPE7"], ["Biceps ", "1", "8-12", "RPE10"]),
  line(["Side planks ", "1", "60", "each side "], ["Back extensions", "3", "12", "bw"]),
  line(["Leg stretch", "", "", ""], ["Jumps ", "2", "5", ""]),
  line(null, ["Back extensions", "3", "12", ""]),
  line(null, null),
  line(null, null),
  line(["2026-10-25", "", "", ""], ["2026-10-27", "", "", ""]),
  line(["Squat", "3", "6", "95"], ["Pullups", "3", "5", "bw+5kg"]),
  line(["Reverse plank", "1", "120s", ""], ["Carry", "2", "1:30", "25kg "]),
].join("\r\n");

test("workouts are found side by side and under each other, in reading order", () => {
  const workouts = parseSheet(sheet);
  assert.deepEqual(workouts.map((workout) => [workout.day, workout.entries[0].name]), [
    [null, "Squat"], [null, "Deadlift"], ["2026-10-25", "Squat"], ["2026-10-27", "Pullups"],
  ]);
  assert.deepEqual(workouts.map(suggestTitle), ["Squat + Bench press", "Deadlift + Pullups", "Squat + Reverse plank, 25 Oct", "Pullups + Carry, 27 Oct"]);
});

test("neighbouring rows of one exercise become one block, and a later repeat stays its own", () => {
  const [first, second] = parseSheet(sheet);
  const bench = first.entries[1];
  assert.equal(bench.name, "Bench press");
  assert.deepEqual(bench.rows.map((row) => [row.count, row.reps, row.load]), [[2, 2, 80], [1, 1, 90], [4, 4, 85]]);
  assert.deepEqual(second.entries.map((entry) => entry.name), ["Deadlift", "Pullups", "Biceps", "Back extensions", "Jumps", "Back extensions"]);
});

test("the cells of a row are read as lifters write them", () => {
  const [first, second, third, fourth] = parseSheet(sheet);
  const entry = (list: SheetEntry[], name: string) => list.find((item) => item.name === name)!;
  assert.deepEqual(entry(first.entries, "Single leg press"), {
    name: "Single leg press", rows: [{ count: 3, reps: 8, repsMax: null, load: null, rpe: 7, duration: null }],
    notes: ["Sets: 1+2R"], bodyweight: false,
  });
  assert.deepEqual(entry(second.entries, "Biceps").rows.map((row) => [row.reps, row.repsMax, row.rpe]), [[6, 8, 10], [8, 12, 10]]);
  assert.deepEqual([entry(second.entries, "Pullups").bodyweight, entry(second.entries, "Pullups").rows[0].load], [true, null]);
  assert.deepEqual([entry(fourth.entries, "Pullups").bodyweight, entry(fourth.entries, "Pullups").rows[0].load], [true, 5]);
  assert.deepEqual(entry(first.entries, "Side planks").notes, ["each side"]);
  assert.equal(entry(third.entries, "Reverse plank").rows[0].duration, 120);
  assert.deepEqual([entry(fourth.entries, "Carry").rows[0].duration, entry(fourth.entries, "Carry").rows[0].load], [90, 25]);
  assert.deepEqual(entry(first.entries, "Leg stretch").rows, [{ count: 1, reps: null, repsMax: null, load: null, rpe: null, duration: null }]);
});

test("two spellings of an exercise are the same exercise", () => {
  assert.equal(sheetKey("Pullups "), sheetKey("Pull-up"));
  assert.equal(sheetKey("Back extensions"), sheetKey("back extension"));
  assert.notEqual(sheetKey("Paused deadlift"), sheetKey("Deadlift"));
  assert.equal(tidyName("  leg curls   full rom(rehab) "), "Leg curls full rom (rehab)");
});

test("a new exercise gets a first reading from its name and its rows", () => {
  const read = (name: string, bodyweight = false, duration: number | null = null) =>
    guessExercise({ name, bodyweight, notes: [], rows: [{ count: 1, reps: 5, repsMax: null, load: null, rpe: null, duration }] });
  assert.deepEqual(read("Close grip bench"), { tracking: "weight_reps", equipment: "barbell", primaryMuscle: "Chest" });
  assert.deepEqual(read("Dumbell press"), { tracking: "weight_reps", equipment: "dumbbell", primaryMuscle: "Chest" });
  assert.deepEqual(read("Step ups"), { tracking: "bodyweight_reps", equipment: "bodyweight", primaryMuscle: "Quads" });
  assert.deepEqual(read("Side planks"), { tracking: "duration", equipment: "bodyweight", primaryMuscle: "Core" });
  assert.deepEqual(read("1 Leg RDL"), { tracking: "weight_reps", equipment: "other", primaryMuscle: "Hamstrings" });
  assert.deepEqual(read("Chest supported row"), { tracking: "weight_reps", equipment: "machine", primaryMuscle: "Back" });
  assert.equal(read("Farmer walk", false, 60).tracking, "duration");
  assert.equal(read("Something unheard of").primaryMuscle, "Full body");
});

test("a row reads back in a line", () => {
  assert.equal(rowLabel({ count: 4, reps: 4, repsMax: null, load: 120, rpe: null, duration: null }, "weight_reps"), "120 × 4 × 4");
  assert.equal(rowLabel({ count: 1, reps: 6, repsMax: 8, load: null, rpe: 10, duration: null }, "weight_reps"), "6–8 reps, RPE 10");
  assert.equal(rowLabel({ count: 3, reps: 5, repsMax: null, load: 5, rpe: null, duration: null }, "bodyweight_reps"), "+5 × 5 × 3");
  assert.equal(rowLabel({ count: 1, reps: 60, repsMax: null, load: null, rpe: null, duration: null }, "duration"), "1:00");
  // A row without numbers still says how many sets it is.
  assert.equal(rowLabel({ count: 1, reps: null, repsMax: null, load: null, rpe: null, duration: null }, "weight_reps"), "1 set");
  assert.equal(rowLabel({ count: 3, reps: null, repsMax: null, load: null, rpe: 7, duration: null }, "weight_reps"), "3 sets, RPE 7");
});

test("a sheet is laid out as the weeks of a block from any first day", () => {
  const workouts = parseSheet(sheet);
  assert.deepEqual(workouts.map((workout) => workout.section), [0, 0, 1, 1]);
  assert.deepEqual(workouts.map(sessionName), ["Squat + Bench press", "Deadlift + Pullups", "Squat + Reverse plank", "Pullups + Carry"]);

  // The dated week trains two days apart, so the undated week of the same size borrows that spread.
  // 2026-11-29 is a Sunday: a block week starts on the day it is given, not on a Monday.
  assert.deepEqual(planBlock(workouts, "2026-11-29"), [
    { week: 1, sessions: [{ index: 0, day: "2026-11-29" }, { index: 1, day: "2026-12-01" }] },
    { week: 2, sessions: [{ index: 2, day: "2026-12-06" }, { index: 3, day: "2026-12-08" }] },
  ]);
  // Newest week on top: the lower group becomes week 1.
  assert.deepEqual(planBlock(workouts, "2026-11-29", true), [
    { week: 1, sessions: [{ index: 2, day: "2026-11-29" }, { index: 3, day: "2026-12-01" }] },
    { week: 2, sessions: [{ index: 0, day: "2026-12-06" }, { index: 1, day: "2026-12-08" }] },
  ]);
  assert.deepEqual(planBlock([], "2026-11-29"), []);
});

test("weeks without usable dates get the usual spread", () => {
  const three = parseSheet([line(["Squat", "3", "5", "100"], ["Bench", "3", "5", "80"], ["Deadlift", "1", "5", "140"])].join("\n"));
  assert.deepEqual(planBlock(three, "2026-11-23")[0].sessions.map(({ day }) => day), ["2026-11-23", "2026-11-25", "2026-11-27"]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map((count) => usualWeekdays(count)), [
    [0], [0, 3], [0, 2, 4], [0, 1, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6],
  ]);
  assert.deepEqual(usualWeekdays(0), []);

  // Dates that run backwards, or over more than a week, say nothing about the spread.
  const backwards = parseSheet([
    line(["2026-10-27", "", "", ""], ["2026-10-25", "", "", ""]),
    line(["Squat", "3", "5", "100"], ["Bench", "3", "5", "80"]),
  ].join("\n"));
  assert.deepEqual(planBlock(backwards, "2026-11-23")[0].sessions.map(({ day }) => day), ["2026-11-23", "2026-11-26"]);
  const farApart = parseSheet([
    line(["2026-10-25", "", "", ""], ["2026-11-04", "", "", ""]),
    line(["Squat", "3", "5", "100"], ["Bench", "3", "5", "80"]),
  ].join("\n"));
  assert.deepEqual(planBlock(farApart, "2026-11-23")[0].sessions.map(({ day }) => day), ["2026-11-23", "2026-11-26"]);
});

test("what a sheet holds beyond the limits is counted, never dropped in silence", () => {
  // 40 workouts stacked under each other: 40 weeks of one session.
  const tall = Array.from({ length: 40 }, (_, at) => `Squat\t3\t5\t${100 + at}`).join("\n\n\n");
  const read = readSheet(tall);
  assert.deepEqual([read.workouts.length, read.found], [sheetLimits.workouts, 40]);
  const plan = planBlock(read.workouts, "2026-11-23");
  assert.deepEqual([plan.length, plan.at(-1)!.week, plan.at(-1)!.sessions[0].day], [sheetLimits.weeks, 16, "2027-03-08"]);
  // Newest on top: week 1 is the bottom of what was read, and the sixteen weeks nearest the bottom are kept.
  assert.equal(planBlock(read.workouts, "2026-11-23", true).at(-1)!.sessions[0].index, 14);

  // Nine workouts side by side: a week takes seven of them.
  const wide = line(...Array.from({ length: 9 }, (_, at) => [`Lift ${at + 1}`, "3", "5", "100"]));
  const [week] = planBlock(parseSheet(wide), "2026-11-23");
  assert.deepEqual(week.sessions.map(({ index, day }) => [index, day.slice(8)]), [[0, "23"], [1, "24"], [2, "25"], [3, "26"], [4, "27"], [5, "28"], [6, "29"]]);
});

test("a paste far wider and longer than any program is cut off, quickly, and says so", () => {
  // One row of 20 000 cells over 90 000 short rows took 40 seconds before the cut.
  const hostile = `${"\t".repeat(20000)}x\n${"x\n".repeat(90000)}`;
  const started = performance.now();
  const read = readSheet(hostile);
  assert.ok(performance.now() - started < 2000, "reading a hostile paste stays quick");
  assert.equal(read.clipped, true);
  assert.ok(read.workouts.length <= sheetLimits.workouts);
  // Used and unused columns in turn: many column groups, still quick.
  const striped = `${"a\t\t".repeat(5000)}\n${"b\t\t".repeat(5000)}\n`.repeat(200);
  const again = performance.now();
  assert.equal(readSheet(striped).clipped, true);
  assert.ok(performance.now() - again < 2000);
  assert.equal(readSheet(sheet).clipped, false);
  assert.equal(readSheet("x".repeat(sheetLimits.characters + 1)).clipped, true);
});

test("the first day suggested for a block falls on the weekday the sheet's weeks start on", () => {
  const workouts = parseSheet(sheet);
  // The sheet's dated week starts on Sunday 25 October.
  assert.equal(suggestStart(workouts, "2026-11-23"), "2026-11-29");
  assert.equal(suggestStart(workouts, "2026-11-29"), "2026-11-29");
  assert.equal(suggestStart(workouts, "2026-11-30"), "2026-12-06");
  assert.equal(suggestStart(parseSheet("Squat\t3\t5\t100"), "2026-11-23"), "2026-11-23");
});

test("a workout becomes a template draft with one set per set", () => {
  const [first] = parseSheet(sheet);
  const draft = buildDraft(first, "Day one", (entry) => ({
    id: "00000000-0000-4000-8000-000000000001", tracking: guessExercise(entry).tracking,
  }));
  assert.deepEqual([draft.title, draft.day, draft.blocks.length], ["Day one", null, 5]);
  assert.deepEqual(draft.blocks.map((block) => block.sets.length), [3, 7, 3, 1, 1]);
  assert.deepEqual(draft.blocks[1].sets.map((set) => [set.target.load, set.target.reps]), [[80, 2], [80, 2], [90, 1], [85, 4], [85, 4], [85, 4], [85, 4]]);
  assert.deepEqual([draft.blocks[2].notes, draft.blocks[2].sets[0].target.rpe], ["Sets: 1+2R", 7]);
  // A bare number in the reps column of a time exercise is seconds.
  assert.deepEqual([draft.blocks[3].sets[0].target.duration, draft.blocks[3].sets[0].target.reps, draft.blocks[3].notes], [60, null, "each side"]);
  assert.ok(draft.blocks.every((block) => block.sets.every((set) => set.loggedAt === null && set.actual.reps === null)));
});

test("column heads are skipped, and text without tabs is read by its gaps", () => {
  const typed = "Exercise   Sets   Reps   Weight\nSquat   3   5   100\nPlank   2   45s";
  const [workout] = parseSheet(typed);
  assert.deepEqual(workout.entries.map((entry) => [entry.name, entry.rows[0].count]), [["Squat", 3], ["Plank", 2]]);
  assert.deepEqual(parseSheet(""), []);
  assert.deepEqual(parseSheet("\t\t\n\n"), []);
});
