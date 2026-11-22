import assert from "node:assert/strict";
import test from "node:test";
import { emptySet, type WorkoutDoc } from "../src/lib/workout-doc";
import { draftOf } from "../src/lib/workout-edit";
import { mirrorKey, readMirror, retryDelay, settleSave, writeMirror } from "../src/lib/workout-sync";

const doc: WorkoutDoc = {
  id: "11111111-1111-4111-8111-111111111111", status: "planned", title: "Upper A", day: "2026-11-22", notes: "",
  templateId: null, startedAt: null, completedAt: null, revision: 4,
  blocks: [{ id: "22222222-2222-4222-8222-222222222222", exerciseId: "33333333-3333-4333-8333-333333333333", notes: "", restSeconds: null, sets: [emptySet({ id: "44444444-4444-4444-8444-444444444444" })] }],
};
const edited = { ...doc, title: "Upper B" };

test("an ok result carries the new revision", () => {
  assert.deepEqual(settleSave({ ok: true, revision: 5, startedAt: "2026-11-22T10:00:00.000Z" }, []), {
    kind: "saved", revision: 5, startedAt: "2026-11-22T10:00:00.000Z",
  });
});

test("a conflict whose current draft is one we sent means the reply was lost", () => {
  const earlier = draftOf(doc);
  const latest = draftOf(edited);
  const result = settleSave({ ok: false, reason: "conflict", current: { ...doc, revision: 5 } }, [earlier, latest]);
  assert.deepEqual(result, { kind: "adopt", revision: 5, draft: draftOf(doc), startedAt: null });
});

test("a conflict with a draft we never sent replaces the local copy", () => {
  const other = { ...doc, title: "Changed on the other phone", revision: 6 };
  const result = settleSave({ ok: false, reason: "conflict", current: other }, [draftOf(edited)]);
  assert.deepEqual(result, { kind: "replace", doc: other });
});

test("invalid and missing pass through", () => {
  assert.deepEqual(settleSave({ ok: false, reason: "invalid", message: "Enter a valid date." }, []), { kind: "invalid", message: "Enter a valid date." });
  assert.deepEqual(settleSave({ ok: false, reason: "missing" }, []), { kind: "missing" });
});

test("retries back off 2, 5, 15 then every 30 seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(retryDelay), [2000, 5000, 15000, 30000, 30000]);
});

test("the mirror is keyed by workout", () => {
  assert.equal(mirrorKey(doc.id), `training-log:workout:${doc.id}`);
});

test("a mirror from the current revision that differs is applied", () => {
  const raw = writeMirror(4, draftOf(edited));
  assert.deepEqual(readMirror(raw, doc), { action: "apply", draft: draftOf(edited) });
});

test("a mirror from another revision is dropped", () => {
  assert.deepEqual(readMirror(writeMirror(3, draftOf(edited)), doc), { action: "drop" });
});

test("a mirror that matches the server, junk, or nothing", () => {
  assert.deepEqual(readMirror(writeMirror(4, draftOf(doc)), doc), { action: "drop" });
  assert.deepEqual(readMirror("{not json", doc), { action: "drop" });
  assert.deepEqual(readMirror(JSON.stringify({ revision: 4, draft: { title: 1 } }), doc), { action: "drop" });
  assert.deepEqual(readMirror(null, doc), { action: "none" });
});
