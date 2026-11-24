// The first frame of the stage as the server writes it: both sizes of the drawing with an id on each shape, the owner's words as text, the caption,
// the counter and the button.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiftStage } from "../app/ui/lift-stage";
import { drawLift } from "../src/lib/lift-draw";
import { makeLiftSet } from "../src/lib/lift-motion";
import { stageFor } from "../src/lib/lift-plan";
import { platesOf, type MainLift } from "../src/lib/lift-row";
import { LIFT_KINDS } from "../src/lib/lifts";

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

const text = (markup: string) => markup.replace(/<br\/?>/g, " ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&");
const captions = (markup: string) => [...markup.matchAll(/<p class="lift-caption"([^>]*)>(.*?)<\/p>/g)].map(([, attrs, inner]) => ({ attrs, words: text(inner) }));

test("the caption reads as a set reads everywhere: exercise, load and reps, the day, the plates per side, and a bar that is not the standard one", () => {
  const [caption] = captions(render([lift()]));
  assert.equal(caption.words, "Low-bar squat 182.5 kilograms, ×3 reps, RPE 8.5, Mon 23 Nov per side 25 + 25 + 25 + 5 + 1.25");
  assert.ok(!caption.words.includes("kg bar"), "the standard bar is not mentioned");
  assert.match(captions(render([lift({ barKg: 15, loadKg: 180 })]))[0].words, /per side .* on a 15 kg bar$/);
  assert.match(captions(render([lift({ loadKg: 20 })]))[0].words, /per side empty bar$/);
  assert.match(captions(render([lift({ loadKg: 820 })]))[0].words, /per side 16 × 25$/, "a long sleeve is written as a count");
});

test("every lift has its caption, in one place, and only the lift on show has one a screen reader reads", () => {
  const markup = render([lift(), lift({ kind: "bench", exercise: "Bench press", loadKg: 130 }), lift({ kind: "deadlift-sumo", exercise: "Sumo", loadKg: 220 })]);
  const all = captions(markup);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((caption) => caption.attrs.includes('aria-hidden="true"')), [false, true, true], "the first lift is on show");
  assert.deepEqual(all.map((caption) => caption.words.split(" ")[0]), ["Low-bar", "Bench", "Sumo"], "in the order of the tabs");
  assert.equal((markup.match(/class="lift-captions"/g) ?? []).length, 1);
});

test("the drawing is an image with a sentence, once for each size; the rep counter is not read out; the button says Play", () => {
  const markup = render([lift()]);
  const images = [...markup.matchAll(/<svg [^>]*role="img"[^>]*aria-label="([^"]+)"/g)].map(([, label]) => label);
  assert.equal(images.length, 2, "one for the wide and one for the narrow drawing");
  assert.match(images[0], /^Low-bar squat, 182\.5 kilograms for 3 reps\. 25, 25, 25, 5, 1\.25 kilograms on each side\. The bar sits low/);
  assert.equal(images[0], images[1]);
  assert.match(markup, /<p class="lift-count" aria-hidden="true">/);
  assert.match(markup, /<button type="button" class="btn btn--plain lift-play">Play<\/button>/);
});

test("the counter before anything plays: the first rep of the set's own reps, and a square for each rep up to the most the row holds", () => {
  const counter = (reps: number) => {
    const count = render([lift({ reps })]).match(/<p class="lift-count"[^>]*>(.*?)<\/p>/)![1];
    return { words: text(count), squares: (count.match(/<i[ >]/g) ?? []).length };
  };
  assert.match(counter(3).words, /^Rep 1 of 3/);
  assert.equal(counter(3).squares, 3);
  assert.equal(counter(10).squares, 10);
  assert.match(counter(30).words, /^Rep 1 of 30/);
  assert.equal(counter(30).squares, 0, "a long set has the words only");
  assert.match(counter(45).words, /^Rep 1 of 30/, "the model draws at most 30 reps");
});

test("the two sizes have the view boxes of the plan, 780 wide and 358 wide", () => {
  const boxes = [...render([lift()]).matchAll(/<svg [^>]*class="lf lf-(wide|narrow)" viewBox="([^"]+)"/g)].map(([, size, box]) => [size, box.split(" ")[2]]);
  assert.deepEqual(boxes, [["wide", "780"], ["narrow", "358"]]);
});

test("the first frame is the set's most telling still, not its start, in every lift and both sizes", () => {
  for (const kind of LIFT_KINDS) {
    const one = lift({ kind, exercise: "Lift", loadKg: 100, reps: 3 });
    const markup = render([one]);
    const set = makeLiftSet(kind, { reps: 3 });
    for (const size of ["wide", "narrow"] as const) {
      const shown = (at: number) => drawLift({ pose: set.pose(at), scene: set.scene, plates: platesOf(one), stage: stageFor(kind, size) }).prims
        .map((prim) => [prim.id, prim.attrs.d ?? `${prim.attrs.x},${prim.attrs.y}`] as const);
      const written = [...markup.match(new RegExp(`<svg [^>]*class="lf lf-${size}".*?</svg>`))![0].matchAll(/<(?:path|text) [^>]*?data-k="([^"]+)"[^>]*?(?: d="([^"]*)"| x="([^"]*)" y="([^"]*)")/g)]
        .map(([, id, d, x, y]) => [id, d ?? `${x},${y}`] as const);
      assert.deepEqual(written, shown(set.heroTime), `${kind} ${size}`);
      assert.notDeepEqual(written, shown(0), `${kind} ${size}: the still is not the start`);
    }
  }
});
