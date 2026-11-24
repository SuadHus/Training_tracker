// What the play button and the page's visibility do to the clock of a set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonWord, initialTransport, isMoving, MAX_STEP, shouldAutoStart, transport, type Transport, type TransportEvent } from "../src/lib/lift-transport";

const run = (events: TransportEvent[], from: Transport = initialTransport) => events.reduce(transport, from);
const SHOW: TransportEvent = { type: "show", duration: 10, hero: 4 };

test("a set that is shown rests on its still, not playing, with the button reading Play", () => {
  const s = run([SHOW]);
  assert.equal(s.t, 4);
  assert.equal(buttonWord(s), "Play");
  assert.equal(isMoving(s), false);
});

test("play starts from the beginning, ticks advance the clock, and the end rests on the still with Replay", () => {
  let s = run([SHOW, { type: "play" }]);
  assert.equal(s.t, 0);
  assert.equal(buttonWord(s), "Pause");
  s = run([{ type: "tick", dt: 0.05 }, { type: "tick", dt: 0.05 }], s);
  assert.ok(Math.abs(s.t - 0.1) < 1e-12);
  s = run([{ type: "seek", t: 9.98 }, { type: "play" }, { type: "tick", dt: 0.05 }], s);
  assert.equal(s.ended, true);
  assert.equal(s.playing, false);
  assert.equal(s.t, 4, "it rests on its most telling still");
  assert.equal(buttonWord(s), "Replay");
  assert.equal(run([{ type: "play" }], s).t, 0, "Replay starts again");
});

test("a pause stops the clock where it is and play goes on from there", () => {
  let s = run([SHOW, { type: "play" }, { type: "tick", dt: 0.1 }, { type: "tick", dt: 0.1 }, { type: "pause" }]);
  assert.equal(isMoving(s), false);
  const t = s.t;
  assert.equal(run([{ type: "tick", dt: 0.1 }], s).t, t, "ticks do nothing while paused");
  s = run([{ type: "play" }], s);
  assert.equal(s.t, t);
});

test("the clock does not run while the stage is off the screen or the tab is hidden, and goes on when it is back", () => {
  const playing = run([SHOW, { type: "play" }]);
  for (const hold of [{ type: "visible", value: false }, { type: "tabHidden", value: true }] as const) {
    const held = run([hold, { type: "tick", dt: 0.05 }], playing);
    assert.equal(held.t, 0);
    assert.equal(held.playing, true, "it still wants to play");
    const back = run([hold.type === "visible" ? { type: "visible", value: true } : { type: "tabHidden", value: false }, { type: "tick", dt: 0.05 }], held);
    assert.ok(back.t > 0);
  }
});

test("a long gap between ticks (a tab that was away) moves the clock by one short step, not across the set", () => {
  const s = run([SHOW, { type: "play" }, { type: "tick", dt: 30 }]);
  assert.equal(s.t, MAX_STEP);
  assert.equal(run([SHOW, { type: "play" }, { type: "tick", dt: -1 }]).t, 0);
});

test("seeking clamps to the set and stops the clock", () => {
  const s = run([SHOW, { type: "play" }, { type: "seek", t: 99 }]);
  assert.equal(s.t, 10);
  assert.equal(s.playing, false);
  assert.equal(run([SHOW, { type: "seek", t: -3 }]).t, 0);
  assert.equal(run([SHOW, { type: "seek", t: Number.NaN }]).t, 0);
});

test("a new set keeps what the eyes and the tab were doing, and forgets what the old set was doing", () => {
  const s = run([SHOW, { type: "play" }, { type: "visible", value: false }, { type: "tabHidden", value: true }, { type: "show", duration: 7, hero: 2 }]);
  assert.equal(s.visible, false);
  assert.equal(s.tabHidden, true);
  assert.deepEqual([s.t, s.duration, s.playing, s.started, s.ended], [2, 7, false, false, false]);
});

test("a set starts by itself when it first comes into view, unless the reader asked for reduced motion, and only once", () => {
  const seen = run([SHOW, { type: "visible", value: true }]);
  assert.equal(shouldAutoStart(seen, false), true);
  assert.equal(shouldAutoStart(seen, true), false);
  assert.equal(shouldAutoStart(run([{ type: "visible", value: false }], seen), false), false, "not while it is out of view");
  assert.equal(shouldAutoStart(run([{ type: "play" }], seen), false), false, "not when it has been played");
  assert.equal(shouldAutoStart(run([{ type: "play" }, { type: "pause" }], seen), false), false, "not again after a pause");
});
