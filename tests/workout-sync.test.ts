import assert from "node:assert/strict";
import test from "node:test";
import { emptySet, noMeasures, type BlockDoc, type SetDoc, type WorkoutDoc, type WorkoutDraft } from "../src/lib/workout-doc";
import { draftOf } from "../src/lib/workout-edit";
import {
  copyKey, fingerprint, isCopyKey, isDraftShape, mirrorKey, readMirror, readMirrors, rebaseDraft, retryDelay, settleSave, writeMirror,
} from "../src/lib/workout-sync";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const at = (minute: number) => `2026-11-22T10:${String(minute).padStart(2, "0")}:00.000Z`;

/** A working set: planned 100 x 5, and logged with those numbers when `done` gives the minute. */
const set = (n: number, done: number | null = null, patch: Partial<SetDoc> = {}): SetDoc => emptySet({
  id: id(n), target: { ...noMeasures, repsMax: null, reps: 5, load: 100 },
  actual: done === null ? { ...noMeasures } : { ...noMeasures, reps: 5, load: 100 },
  loggedAt: done === null ? null : at(done), ...patch,
});
const block = (n: number, sets: SetDoc[], patch: Partial<BlockDoc> = {}): BlockDoc => ({
  id: id(100 + n), exerciseId: id(200 + n), notes: "", restSeconds: null, sets, ...patch,
});
const draft = (blocks: BlockDoc[], patch: Partial<WorkoutDraft> = {}): WorkoutDraft => ({ title: "Upper A", day: "2026-11-22", notes: "", blocks, ...patch });
const server = (from: WorkoutDraft, revision: number): WorkoutDoc => ({
  id: "11111111-1111-4111-8111-111111111111", status: "planned", templateId: null, startedAt: null, completedAt: null, revision, ...from,
});
const logged = (from: WorkoutDraft) => from.blocks.map((item) => item.sets.map((one) => (one.loggedAt ? one.actual.reps : "-")).join(""));

const doc = server(draft([block(1, [set(1)])]), 4);
const edited = { ...doc, title: "Upper B" };

test("an ok result carries the new revision", () => {
  assert.deepEqual(settleSave({ ok: true, revision: 5, startedAt: "2026-11-22T10:00:00.000Z" }, []), {
    kind: "saved", revision: 5, startedAt: "2026-11-22T10:00:00.000Z",
  });
});

test("a conflict whose current draft is one we sent means the reply was lost", () => {
  const result = settleSave({ ok: false, reason: "conflict", current: { ...doc, revision: 5 } }, [draftOf(doc), draftOf(edited)]);
  assert.deepEqual(result, { kind: "adopt", revision: 5, draft: draftOf(doc), startedAt: null });
});

test("a conflict with a draft we never sent asks for the unsaved work to be carried over", () => {
  const other = { ...doc, title: "Changed on the other phone", revision: 6 };
  assert.deepEqual(settleSave({ ok: false, reason: "conflict", current: other }, [draftOf(edited)]), { kind: "rebase", doc: other });
});

test("invalid and missing pass through", () => {
  assert.deepEqual(settleSave({ ok: false, reason: "invalid", message: "Enter a valid date." }, []), { kind: "invalid", message: "Enter a valid date." });
  assert.deepEqual(settleSave({ ok: false, reason: "missing" }, []), { kind: "missing" });
});

test("retries back off 2, 5, 15 then every 30 seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(retryDelay), [2000, 5000, 15000, 30000, 30000]);
});

// Carrying unsaved work over ------------------------------------------------------

test("sets logged on a stale tab survive a newer version from another device", () => {
  // Both tabs opened the session with nothing logged. The other one logged set 1; this one logged sets 2 and 3.
  const base = draft([block(1, [set(1), set(2), set(3)])]);
  const theirs = draft([block(1, [set(1, 1), set(2), set(3)])]);
  const mine = draft([block(1, [set(1), set(2, 2), set(3, 3)])]);
  const merged = rebaseDraft(base, mine, theirs);
  assert.deepEqual(logged(merged), ["555"]);
  assert.deepEqual(merged.blocks[0].sets.map((one) => one.loggedAt), [at(1), at(2), at(3)]);
});

test("a save that arrived while its reply was lost changes nothing about what the phone holds", () => {
  // The phone sent set 1 (the server took it), then logged sets 2 and 3 and typed a note.
  const base = draft([block(1, [set(1), set(2), set(3)])]);
  const theirs = draft([block(1, [set(1, 1), set(2), set(3)])]);
  const mine = draft([block(1, [set(1, 1), set(2, 2), set(3, 3)], { notes: "Elbows in" })], { notes: "Good day" });
  assert.deepEqual(rebaseDraft(base, mine, theirs), mine);
});

test("each side keeps the fields only it changed, down to one number in a set", () => {
  const base = draft([block(1, [set(1, 1)]), block(2, [set(2)])]);
  // There: an effort on the logged set, a new title, a cue on the second exercise.
  const theirs = draft([
    block(1, [set(1, 1, { actual: { ...noMeasures, reps: 5, load: 100, rpe: 8 } })]), block(2, [set(2)], { notes: "Slow down" }),
  ], { title: "Upper A, heavy" });
  // Here: the reps of that same set corrected, a note, a rest time on the second exercise.
  const mine = draft([
    block(1, [set(1, 1, { actual: { ...noMeasures, reps: 4, load: 100 } })]), block(2, [set(2)], { restSeconds: 90 }),
  ], { notes: "Shoulder fine" });
  const merged = rebaseDraft(base, mine, theirs);
  assert.deepEqual([merged.title, merged.notes], ["Upper A, heavy", "Shoulder fine"]);
  assert.deepEqual(merged.blocks[0].sets[0].actual, { ...noMeasures, reps: 4, load: 100, rpe: 8 });
  assert.deepEqual([merged.blocks[1].notes, merged.blocks[1].restSeconds], ["Slow down", 90]);
  // Where both changed the same number, the phone in hand wins.
  const clash = rebaseDraft(base, draft([block(1, [set(1, 1, { actual: { ...noMeasures, reps: 3, load: 100 } })]), block(2, [set(2)])]),
    draft([block(1, [set(1, 1, { actual: { ...noMeasures, reps: 6, load: 100 } })]), block(2, [set(2)])]));
  assert.equal(clash.blocks[0].sets[0].actual.reps, 3);
});

test("what one side added or removed is added or removed, and nothing logged is lost to a removal", () => {
  const base = draft([block(1, [set(1), set(2)]), block(2, [set(3)]), block(3, [set(4)])]);
  // There: a set added to the first exercise, the second exercise removed, a new exercise at the end.
  const theirs = draft([block(1, [set(1), set(2), set(5)]), block(3, [set(4)]), block(4, [set(6)])]);
  // Here: set 2 removed, a set logged in the second exercise (the one removed there), an exercise added first.
  const mine = draft([block(5, [set(7)]), block(1, [set(1)]), block(2, [set(3, 9)]), block(3, [set(4)])]);
  const merged = rebaseDraft(base, mine, theirs);
  assert.deepEqual(merged.blocks.map((item) => item.id), [id(105), id(101), id(102), id(103), id(104)]);
  assert.deepEqual(merged.blocks[1].sets.map((one) => one.id), [id(1), id(5)]);
  assert.deepEqual(logged(merged), ["-", "--", "5", "-", "-"]);

  // An exercise removed here comes back when the other side logged in it since; an untouched one stays removed.
  const kept = rebaseDraft(base, draft([block(1, [set(1), set(2)]), block(3, [set(4)])]),
    draft([block(1, [set(1), set(2)]), block(2, [set(3, 7)]), block(3, [set(4)])]));
  assert.deepEqual(kept.blocks.map((item) => item.id), [id(101), id(102), id(103)]);
  const gone = rebaseDraft(base, draft([block(1, [set(1), set(2)]), block(3, [set(4)])]), base);
  assert.deepEqual(gone.blocks.map((item) => item.id), [id(101), id(103)]);
  // The same for one set: removed here, logged there since.
  const oneSet = rebaseDraft(base, draft([block(1, [set(1)]), block(2, [set(3)]), block(3, [set(4)])]),
    draft([block(1, [set(1), set(2, 4)]), block(2, [set(3)]), block(3, [set(4)])]));
  assert.deepEqual(oneSet.blocks[0].sets.map((one) => [one.id, one.loggedAt]), [[id(1), null], [id(2), at(4)]]);
});

test("the order follows whoever moved things", () => {
  const base = draft([block(1, []), block(2, []), block(3, [])]);
  const moved = draft([block(3, []), block(1, []), block(2, [])]);
  const added = draft([block(1, []), block(4, []), block(2, []), block(3, [])]);
  assert.deepEqual(rebaseDraft(base, moved, added).blocks.map((item) => item.id), [id(103), id(101), id(104), id(102)]);
  assert.deepEqual(rebaseDraft(base, added, moved).blocks.map((item) => item.id), [id(103), id(101), id(104), id(102)]);
  assert.deepEqual(rebaseDraft(base, base, moved), moved);
});

test("un-logging is kept when one side did it on purpose, and a tick never stays over nothing", () => {
  const base = draft([block(1, [set(1, 1), set(2, 2)])]);
  const mine = draft([block(1, [set(1, null, { actual: { ...noMeasures, reps: 5, load: 100 } }), set(2, 2)])]);
  assert.deepEqual(logged(rebaseDraft(base, mine, base)), ["-5"]);
  // There the numbers of set 2 were cleared, which takes it out of the log; here it was logged again. The tick brings its numbers.
  const cleared = draft([block(1, [set(1, 1), set(2)])]);
  const retimed = draft([block(1, [set(1, 1), set(2, 9)])]);
  const merged = rebaseDraft(base, retimed, cleared);
  assert.deepEqual([merged.blocks[0].sets[1].loggedAt, merged.blocks[0].sets[1].actual.reps], [at(9), 5]);
  // And the other way round: un-logged here on purpose, re-timed there. The un-log of the phone in hand stands.
  assert.equal(rebaseDraft(base, cleared, retimed).blocks[0].sets[1].loggedAt, null);
});

test("a logged set travels whole: its numbers are the ones its tick was given", () => {
  // Typed but not logged yet: 100 x 5. One side taps done; the other clears the reps field of its stale draft.
  const typed = set(1, null, { actual: { ...noMeasures, reps: 5, load: 100 } });
  const base = draft([block(1, [typed])]);
  const done = draft([block(1, [set(1, 3)])]);
  const emptied = draft([block(1, [set(1, null, { actual: { ...noMeasures, load: 100 } })])]);
  for (const merged of [rebaseDraft(base, done, emptied), rebaseDraft(base, emptied, done)]) {
    assert.deepEqual([merged.blocks[0].sets[0].loggedAt, merged.blocks[0].sets[0].actual], [at(3), { ...noMeasures, reps: 5, load: 100 }]);
  }
  // Both sides log the same set with different numbers: the result is one of the two, never a mix.
  const empty = draft([block(1, [set(1)])]);
  const here = draft([block(1, [set(1, 4, { actual: { ...noMeasures, reps: 5, load: 60 } })])]);
  const there = draft([block(1, [set(1, 6, { actual: { ...noMeasures, reps: 8, load: 100, rpe: 9 } })])]);
  assert.deepEqual(rebaseDraft(empty, here, there).blocks[0].sets[0], here.blocks[0].sets[0]);
  assert.deepEqual(rebaseDraft(empty, there, here).blocks[0].sets[0], there.blocks[0].sets[0]);
  // Numbers typed on both sides into a set nobody ticked are still combined field by field.
  const loaded = draft([block(1, [set(1, null, { actual: { ...noMeasures, load: 105 } })])]);
  const counted = draft([block(1, [set(1, null, { actual: { ...noMeasures, reps: 4 } })])]);
  assert.deepEqual(rebaseDraft(empty, loaded, counted).blocks[0].sets[0].actual, { ...noMeasures, reps: 4, load: 105 });
});

test("sets logged for an exercise that the other side replaced move to a block of their own", () => {
  const base = draft([block(1, [set(1), set(2), set(3)]), block(2, [set(4)])]);
  // There: the first exercise was replaced by one that records time, which cleared its sets.
  const cleared = (n: number) => emptySet({ id: id(n) });
  const replaced = draft([block(1, [cleared(1), cleared(2), cleared(3)], { exerciseId: id(299) }), block(2, [set(4)])]);
  // Here, on a stale tab: set 2 of the old exercise was logged.
  const stale = draft([block(1, [set(1), set(2, 5), set(3)]), block(2, [set(4)])]);
  for (const merged of [rebaseDraft(base, stale, replaced), rebaseDraft(base, replaced, stale)]) {
    assert.deepEqual(merged.blocks.map((item) => [item.exerciseId, item.sets.map((one) => one.id)]), [
      [id(299), [id(1), id(3)]], [id(201), [id(2)]], [id(202), [id(4)]],
    ]);
    assert.deepEqual([merged.blocks[1].sets[0].loggedAt, merged.blocks[1].sets[0].actual.load], [at(5), 100]);
    assert.ok(isDraftShape(merged), "the new block has an id of the usual shape, and no id is used twice");
    // Merging again changes nothing: the tab that merged holds the result, and so does the server once it is saved.
    assert.deepEqual(rebaseDraft(replaced, merged, merged), merged);
    assert.deepEqual(rebaseDraft(merged, merged, merged), merged);
  }
  // A third tab, staler still, logs another set of the old exercise: it joins the same block.
  const first = rebaseDraft(base, stale, replaced);
  const third = draft([block(1, [set(1, 7), set(2), set(3)]), block(2, [set(4)])]);
  const again = rebaseDraft(base, third, first);
  assert.deepEqual(again.blocks.map((item) => item.sets.map((one) => one.id)), [[id(3)], [id(2), id(1)], [id(4)]]);
  assert.ok(isDraftShape(again));
  // A tab that replaced the exercise itself and still holds set 2 unlogged: the logged one in its own block wins.
  const other = draft([block(1, [set(1), set(2), set(3)], { exerciseId: id(298) }), block(2, [set(4)])]);
  const kept = rebaseDraft(base, other, first);
  assert.deepEqual(kept.blocks.map((item) => [item.exerciseId, item.sets.map((one) => `${one.id === id(2) ? "two" : "-"}${one.loggedAt ? "L" : ""}`).join(" ")]), [
    [id(298), "- -"], [id(201), "twoL"], [id(202), "-"],
  ]);
  assert.ok(isDraftShape(kept));
  // Nothing logged on the other side: the block is simply the replaced one.
  assert.deepEqual(rebaseDraft(base, base, replaced), replaced);
});

test("with no base to compare with, everything both sides hold is kept and a logged set stays logged", () => {
  const theirs = draft([block(1, [set(1, 1), set(2)]), block(2, [set(3, 3)])]);
  const mine = draft([block(1, [set(1), set(2, 2), set(4, 4)])], { notes: "From the phone" });
  const merged = rebaseDraft(null, mine, theirs);
  assert.equal(merged.notes, "From the phone");
  assert.deepEqual(merged.blocks.map((item) => item.sets.map((one) => one.id)), [[id(1), id(2), id(4)], [id(3)]]);
  assert.deepEqual(logged(merged), ["555", "5"]);
});

// The copy kept on the phone ------------------------------------------------------

test("the mirror is keyed by workout", () => {
  assert.equal(mirrorKey(doc.id), `training-log:workout:${doc.id}`);
});

test("a copy from the current revision that differs is applied as it is", () => {
  const raw = writeMirror(4, draftOf(edited), draftOf(doc), []);
  assert.deepEqual(readMirror(raw, doc), { action: "apply", draft: draftOf(edited), merged: false });
});

test("a copy whose save arrived while the reply was lost is applied as it is", () => {
  // Revision 0 on the phone. It sent set 1, the server took it (revision 1), the reply never came,
  // and sets 2 and 3 were logged before the tab closed.
  const base = draft([block(1, [set(1), set(2), set(3)])]);
  const sent = draft([block(1, [set(1, 1), set(2), set(3)])]);
  const mine = draft([block(1, [set(1, 1), set(2, 2), set(3, 3)])]);
  assert.deepEqual(readMirror(writeMirror(0, mine, base, [sent]), server(sent, 1)), { action: "apply", draft: mine, merged: false });
  // Even with nothing recorded as sent, the three logged sets come through.
  const found = readMirror(writeMirror(0, mine, base, []), server(sent, 1));
  assert.deepEqual(found, { action: "apply", draft: mine, merged: true });
});

test("a copy made before another device moved on is carried over to the newer version", () => {
  const base = draft([block(1, [set(1), set(2), set(3)])]);
  const theirs = draft([block(1, [set(1, 1), set(2), set(3)])], { title: "Renamed elsewhere" });
  const mine = draft([block(1, [set(1), set(2, 2), set(3, 3)])]);
  const found = readMirror(writeMirror(0, mine, base, []), server(theirs, 3));
  assert.equal(found.action, "apply");
  if (found.action !== "apply") return;
  assert.equal(found.merged, true);
  assert.deepEqual([found.draft.title, logged(found.draft)], ["Renamed elsewhere", ["555"]]);
  // A copy left by the version before this one has no base: its logged sets still come through.
  const old = readMirror(JSON.stringify({ revision: 0, draft: mine }), server(theirs, 3));
  assert.equal(old.action === "apply" && old.merged && logged(old.draft).join(), "555");
});

test("two tabs' copies are both carried over, whichever was written last", () => {
  // Both tabs were offline on revision 0. One logged sets 1 and 2, the other set 3 and a note.
  const base = draft([block(1, [set(1), set(2), set(3)])]);
  const first = writeMirror(0, draft([block(1, [set(1, 1), set(2, 2), set(3)])]), base, []);
  const second = writeMirror(0, draft([block(1, [set(1), set(2), set(3, 3)])], { notes: "Left knee fine" }), base, []);
  for (const copies of [[first, second], [second, first], [null, first, "{junk", second]]) {
    const found = readMirrors(copies, server(base, 0));
    assert.equal(found.action, "apply");
    if (found.action !== "apply") return;
    assert.deepEqual([logged(found.draft), found.draft.notes, found.merged], [["555"], "Left knee fine", true]);
  }
  // The same when the server has moved on in the meantime.
  const moved = server(draft([block(1, [set(1), set(2), set(3)])], { title: "Renamed" }), 2);
  const found = readMirrors([first, second], moved);
  assert.equal(found.action === "apply" && `${found.draft.title} ${logged(found.draft)}`, "Renamed 555");
  assert.deepEqual(readMirrors([], doc), { action: "none" });
  assert.deepEqual(readMirrors([null, null], doc), { action: "none" });
  assert.deepEqual(readMirrors(["{junk", "null"], doc), { action: "drop" });
  assert.equal(copyKey(doc.id, "tab-1"), `training-log:workout:${doc.id}:tab-1`);
  assert.deepEqual([mirrorKey(doc.id), copyKey(doc.id, "t"), `training-log:workout:${id(9)}:t`, "other"].map((key) => isCopyKey(key, doc.id)), [true, true, false, false]);
});

test("a copy with nothing of its own, junk, or a shape that cannot be drawn is dropped", () => {
  assert.deepEqual(readMirror(writeMirror(4, draftOf(doc), draftOf(doc), []), doc), { action: "drop" });
  // The server already holds everything the stale copy has.
  const base = draft([block(1, [set(1)])]);
  assert.deepEqual(readMirror(writeMirror(2, draft([block(1, [set(1, 1)])]), base, []), server(draft([block(1, [set(1, 1)])]), 9)), { action: "drop" });
  assert.deepEqual(readMirror("{not json", doc), { action: "drop" });
  assert.deepEqual(readMirror("null", doc), { action: "drop" });
  assert.deepEqual(readMirror("[]", doc), { action: "drop" });
  for (const bad of [
    { title: 1 }, { title: "x", day: "2026-11-23", notes: "", blocks: [{}] },
    { title: "x", day: null, notes: "", blocks: [{ id: id(1), exerciseId: id(2), notes: "", restSeconds: null, sets: [{ id: id(3) }] }] },
    { title: "x", day: null, notes: "", blocks: [block(1, [{ ...set(1), actual: { reps: "5" } } as unknown as SetDoc])] },
    { title: "x", day: null, notes: "", blocks: "none" },
    // Ids the server could never take: not an id, or one id used twice.
    { title: "x", day: null, notes: "", blocks: [{ ...block(1, [set(1)]), id: "a" }] },
    { title: "x", day: null, notes: "", blocks: [block(1, [set(1), set(1)])] },
    { title: "x", day: null, notes: "", blocks: [block(1, [set(1)]), block(1, [set(2)])] },
    { title: "x", day: null, notes: "", blocks: [block(1, [set(1)]), block(2, [set(1)])] },
  ]) {
    assert.equal(isDraftShape(bad), false, JSON.stringify(bad));
    assert.deepEqual(readMirror(JSON.stringify({ revision: 4, draft: bad }), doc), { action: "drop" });
  }
  assert.equal(isDraftShape(draftOf(doc)), true);
  assert.deepEqual(readMirror(null, doc), { action: "none" });
});

test("equal drafts have one fingerprint whatever the order of their keys", () => {
  const one = draft([block(1, [set(1, 1)])]);
  const reordered = JSON.parse(JSON.stringify({ blocks: one.blocks.map((item) => ({ sets: item.sets, restSeconds: null, notes: "", exerciseId: item.exerciseId, id: item.id })), notes: "", day: one.day, title: one.title }));
  assert.equal(fingerprint(one), fingerprint(reordered));
  assert.match(fingerprint(one), /^[0-9a-f]{16}$/);
  const seen = new Set([one, draft([block(1, [set(1, 2)])]), draft([block(1, [set(1)])]), draft([block(2, [set(1, 1)])]), draft([], { notes: " " })].map(fingerprint));
  assert.equal(seen.size, 5);
});
