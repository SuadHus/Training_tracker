import assert from "node:assert/strict";
import test from "node:test";
import { formatDurationInput, parseDurationInput } from "../src/lib/duration-input";

test("plain seconds, minutes and seconds, and hours", () => {
  assert.equal(parseDurationInput("90"), 90);
  assert.equal(parseDurationInput("1:30"), 90);
  assert.equal(parseDurationInput("0:45"), 45);
  assert.equal(parseDurationInput("1:02:30"), 3750);
  assert.equal(parseDurationInput(" 2:5 "), 125);
});

test("an empty field is null, not zero", () => {
  assert.equal(parseDurationInput(""), null);
  assert.equal(parseDurationInput("   "), null);
});

test("anything else is invalid", () => {
  for (const text of ["abc", "1:75", "1:2:3:4", "-5", "1,5", "1.5", ":30", "1:", "90s", "1:60", "2:61:00", "86401", "25:00:00"]) {
    assert.equal(parseDurationInput(text), "invalid", text);
  }
});

test("the longest accepted time is a day", () => {
  assert.equal(parseDurationInput("24:00:00"), 86400);
  assert.equal(parseDurationInput("86400"), 86400);
});

test("formatting always shows a colon and round-trips", () => {
  assert.equal(formatDurationInput(45), "0:45");
  assert.equal(formatDurationInput(90), "1:30");
  assert.equal(formatDurationInput(3750), "1:02:30");
  assert.equal(formatDurationInput(0), "0:00");
  for (const seconds of [0, 5, 59, 60, 61, 599, 3600, 3661, 86400]) {
    assert.equal(parseDurationInput(formatDurationInput(seconds)), seconds);
  }
});
