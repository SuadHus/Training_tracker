// The first frame of the stage as the server writes it: both sizes of the drawing with an id on each shape, and the owner's words as text.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiftStage } from "../app/ui/lift-stage";
import type { MainLift } from "../src/lib/lift-row";

const lift = (over: Partial<MainLift> = {}): MainLift => ({ kind: "squat-low", exercise: "Low-bar squat", loadKg: 182.5, barKg: 20, reps: 3, rpe: 8.5, day: "Mon 23 Nov", ...over });
const render = (lifts: MainLift[]) => renderToStaticMarkup(createElement(LiftStage, { lifts }));

test("an exercise name with quotes, angle brackets and an ampersand is written as text, in the caption and in the picture's description", () => {
  const markup = render([lift({ exercise: '"<b>&' })]);
  assert.ok(!markup.includes('"<b>&'), "the name is not written as it was typed");
  assert.ok(markup.includes("&quot;&lt;b&gt;&amp;"), "the name is escaped");
  assert.match(markup, /aria-label="&quot;&lt;b&gt;&amp;, 182.5 kilograms for 3 reps\./);
});

test("the first frame carries both sizes of the drawing, and every shape has an id the player can adopt it by", () => {
  const markup = render([lift()]);
  const drawings = [...markup.matchAll(/<svg [^>]*class="lf lf-(wide|narrow)"[^>]*>(.*?)<\/svg>/g)];
  assert.deepEqual(drawings.map((drawing) => drawing[1]), ["wide", "narrow"]);
  for (const [, size, shapes] of drawings) {
    const ids = [...shapes.matchAll(/<(?:path|text) [^>]*data-k="([^"]+)"/g)].map((shape) => shape[1]);
    const count = (shapes.match(/<(?:path|text)[ >]/g) ?? []).length;
    assert.ok(count > 20, `${size} draws the lifter and the bar`);
    assert.equal(ids.length, count, `${size}: every shape has an id`);
    assert.equal(new Set(ids).size, ids.length, `${size}: no two shapes share an id`);
  }
});

test("tabs appear only when the week has more than one lift", () => {
  assert.ok(!render([lift()]).includes("lift-tabs"));
  const markup = render([lift(), lift({ kind: "bench", exercise: "Bench press", loadKg: 130 })]);
  assert.equal((markup.match(/aria-pressed="/g) ?? []).length, 2);
  assert.match(markup, /aria-pressed="true"[^>]*aria-label="Low-bar squat"/);
});
