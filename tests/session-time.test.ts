import assert from "node:assert/strict";
import test from "node:test";
import { finishTime, formatSessionTime, isSessionMinutes, measuredMinutes, parseSessionTime, shownMinutes } from "../src/lib/session-time";

test("an empty field is null: use the measured time", () => {
  assert.equal(parseSessionTime(""), null);
  assert.equal(parseSessionTime("   "), null);
});

test("plain minutes", () => {
  assert.equal(parseSessionTime("100"), 100);
  assert.equal(parseSessionTime("45"), 45);
  assert.equal(parseSessionTime("1"), 1);
  assert.equal(parseSessionTime("090"), 90);
});

test("hours and minutes mean the same as the minutes they add up to", () => {
  assert.equal(parseSessionTime("1:40"), 100);
  assert.equal(parseSessionTime("1:40"), parseSessionTime("100"));
  assert.equal(parseSessionTime("0:45"), 45);
  assert.equal(parseSessionTime("2:00"), 120);
  assert.equal(parseSessionTime("01:05"), 65);
  assert.equal(parseSessionTime("12:59"), 779);
});

test("spaces around the entry and around the colon are ignored", () => {
  assert.equal(parseSessionTime(" 100 "), 100);
  assert.equal(parseSessionTime("  1:40  "), 100);
  assert.equal(parseSessionTime("1 : 40"), 100);
  assert.equal(parseSessionTime("\t1:40\n"), 100);
});

test("zero is not a time", () => {
  for (const text of ["0", "00", "0:00", "00:00"]) assert.equal(parseSessionTime(text), "invalid", text);
  assert.equal(parseSessionTime("0:01"), 1);
});

test("a session is at most a day", () => {
  assert.equal(parseSessionTime("1440"), 1440);
  assert.equal(parseSessionTime("24:00"), 1440);
  for (const text of ["1441", "24:01", "25:00", "99:59", "9999"]) assert.equal(parseSessionTime(text), "invalid", text);
});

test("anything else is invalid, never guessed at", () => {
  const nonsense = [
    "abc", "-5", "+5", "1.5", "1,5", "1.40", "1:5", "1:60", "1:75", ":30", "1:", ":", "1:2:3", "1::40",
    "90 min", "1h40", "1 h 40", "1 40", "10000", "١٠٠", "1e2", "0x10", "NaN", "∞", "1:40 pm",
  ];
  for (const text of nonsense) assert.equal(parseSessionTime(text), "invalid", JSON.stringify(text));
});

test("formatting reads back as the same minutes", () => {
  assert.equal(formatSessionTime(45), "45");
  assert.equal(formatSessionTime(59), "59");
  assert.equal(formatSessionTime(60), "1:00");
  assert.equal(formatSessionTime(100), "1:40");
  assert.equal(formatSessionTime(125), "2:05");
  assert.equal(formatSessionTime(1440), "24:00");
  for (let minutes = 1; minutes <= 1440; minutes += 1) assert.equal(parseSessionTime(formatSessionTime(minutes)), minutes);
});

const at = (time: string) => new Date(`2026-11-22T${time}:00Z`);

test("the measured time runs from the first to the last logged set, in whole minutes", () => {
  assert.equal(measuredMinutes(at("09:00"), at("10:40")), 100);
  assert.equal(measuredMinutes(at("09:00"), new Date("2026-11-22T09:20:29Z")), 20);
  assert.equal(measuredMinutes(null, at("10:40")), null);
  assert.equal(measuredMinutes(at("09:00"), null), null);
});

test("a measured time outside 5 to 360 minutes is a forgotten timer", () => {
  assert.equal(measuredMinutes(at("09:00"), at("09:04")), null);
  assert.equal(measuredMinutes(at("09:00"), at("09:05")), 5);
  assert.equal(measuredMinutes(at("09:00"), at("15:00")), 360);
  assert.equal(measuredMinutes(at("09:00"), at("15:01")), null);
  assert.equal(measuredMinutes(at("10:00"), at("09:00")), null);
});

test("a typed time wins over the measured one and is shown as typed", () => {
  assert.equal(shownMinutes(100, at("09:00"), at("09:30")), 100);
  assert.equal(shownMinutes(100, null, null), 100);
  // The forgotten-timer rule is for the measured time only.
  assert.equal(shownMinutes(2, at("09:00"), at("09:30")), 2);
  assert.equal(shownMinutes(600, at("09:00"), at("09:30")), 600);
  assert.equal(shownMinutes(1440, null, null), 1440);
  assert.equal(shownMinutes(null, at("09:00"), at("09:30")), 30);
  assert.equal(shownMinutes(null, at("09:00"), at("09:02")), null);
});

test("only whole minutes from 1 to a day are a session time", () => {
  for (const good of [1, 100, 1440]) assert.equal(isSessionMinutes(good), true, String(good));
  // What the action receives is whatever the client sent: a string, NaN, nothing, a fraction are all refused.
  for (const bad of ["100", "", NaN, Infinity, undefined, null, 1.5, 0, -5, 1441, {}, [100], true]) {
    assert.equal(isSessionMinutes(bad), false, String(bad));
  }
});

test("finishing sends what was typed, or stops on what cannot be read", () => {
  assert.deepEqual(finishTime(""), { stop: false, minutes: null });
  assert.deepEqual(finishTime("1:40"), { stop: false, minutes: 100 });
  assert.deepEqual(finishTime(" 100 "), { stop: false, minutes: 100 });
  assert.deepEqual(finishTime("abc"), { stop: true });
  assert.deepEqual(finishTime("0"), { stop: true });
  assert.deepEqual(finishTime("1441"), { stop: true });
});
