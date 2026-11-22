import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDraft, guessExercise, parseSheet, rowLabel, sheetKey, suggestTitle, tidyName, type SheetEntry,
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
  assert.equal(rowLabel({ count: 1, reps: null, repsMax: null, load: null, rpe: null, duration: null }, "weight_reps"), "no numbers");
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
