import { test } from "node:test";
import assert from "node:assert/strict";
import { capsuleSub, circleSub, discHullSub, ellipseSub, fmt, hullSub } from "../src/lib/lift-geometry";
import { platesPerSide } from "../src/lib/workout-doc";
import { plateLook } from "../src/lib/plate-look";

test("numbers are written with one decimal and never as -0", () => {
  assert.equal(fmt(0), "0");
  assert.equal(fmt(-0.04), "0");
  assert.equal(fmt(1.25), "1.3");
  assert.equal(fmt(-12.34), "-12.3");
  assert.equal(fmt(7), "7");
  assert.equal(fmt(100.04), "100");
});

test("shapes survive degenerate input", () => {
  const same = capsuleSub([10, 10], 5, [10, 10], 5);
  const inside = capsuleSub([10, 10], 9, [11, 10], 2);
  const flat = discHullSub([50, 50], [0, 0], 10, 0, [0, 0]);
  const edge = discHullSub([50, 50], [8, 0], 10, 0, [1, 0]);
  const hull = hullSub([[[0, 0], 5], [[0, 0], 5]]);
  for (const d of [same, inside, flat, edge, hull, circleSub([0, 0], 0), ellipseSub([0, 0], 0, 0, 0)]) assert.ok(!/NaN|Infinity/.test(d), d);
});

test("a capsule of two equal circles is a stadium: two straight sides and two half circles of the same radius", () => {
  const d = capsuleSub([0, 0], 10, [40, 0], 10);
  assert.equal(d, "M0 10L40 10A10 10 0 0 0 40 -10L0 -10A10 10 0 0 0 0 10Z");
});

test("plates per side: heaviest first, change plates, no stack past sixteen", () => {
  assert.deepEqual(platesPerSide(20), []);
  assert.deepEqual(platesPerSide(182.5), [25, 25, 25, 5, 1.25]);
  assert.deepEqual(platesPerSide(300), [25, 25, 25, 25, 25, 15]);
  assert.equal(platesPerSide(19), null);
  assert.equal(platesPerSide(21), null);
  assert.equal(platesPerSide(1000), null);
});

test("the plate look follows the site: diameter and thickness step down with the weight, a class per colour", () => {
  const kgs = [25, 20, 15, 10, 5, 2.5, 1.25];
  const looks = kgs.map(plateLook);
  assert.deepEqual(looks.map((l) => l.cls), ["p-25", "p-20", "p-15", "p-10", "p-5", "p-2-5", "p-1-25"]);
  for (let i = 1; i < looks.length; i++) {
    assert.ok(looks[i].thickness <= looks[i - 1].thickness);
    assert.ok(looks[i].diameter <= looks[i - 1].diameter);
  }
});
