import assert from "node:assert/strict";
import test from "node:test";
import { parseDate, parseTypedFields, readActualSet } from "../src/lib/training-admin";

const weight = { id: "speed", label: "Bar speed", kind: "decimal" as const };
const technique = { id: "comment", label: "Technique", kind: "text" as const };

test("additional fields preserve zero, omit blanks, and ignore out-of-scope fields", () => {
  const form = new FormData();
  form.set("custom_speed", "0");
  form.set("custom_comment", " ");
  form.set("custom_unknown", "unexpected");
  assert.deepEqual(parseTypedFields(form, [weight, technique]), { speed: 0 });
});

test("actual sets include unloaded reps and timed work without inventing a load", () => {
  const form = new FormData();
  form.set("reps", "12");
  assert.deepEqual(readActualSet(form, []), { reps: 12, load: null, rpe: null, duration: null, distance: null, values: {} });
  form.delete("reps");
  form.set("custom_speed", "2.45");
  assert.deepEqual(readActualSet(form, [weight]), {
    reps: null,
    load: null,
    rpe: null,
    duration: null,
    distance: null,
    values: { speed: 2.45 },
  });
  assert.throws(() => readActualSet(new FormData(), []), /custom measurement/i);
});

test("an impossible date is rejected before reaching PostgreSQL", () => {
  assert.equal(parseDate("2028-02-29"), "2028-02-29");
  assert.throws(() => parseDate("2026-02-29"), /date/i);
});
