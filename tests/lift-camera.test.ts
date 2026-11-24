// The stage plans: how the two views sit on the stage, at what scale, on which floor, and what the cameras show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawLift } from "../src/lib/lift-draw";
import { makeLiftSet } from "../src/lib/lift-motion";
import { computePlans, stageFor } from "../src/lib/lift-plan";
import { PLANS } from "../src/lib/lift-plans";
import { basis, CAMERAS, dot3, MAX_HEIGHT, STRIP_HEIGHT, type StageSize, type ViewPlan } from "../src/lib/lift-camera";
import { repSegments, samplePoses } from "../src/lib/lift-set";
import { LIFT_KINDS, liftFamily } from "../src/lib/lifts";
import { platesPerSide } from "../src/lib/workout-doc";

const SIZES: StageSize[] = ["wide", "narrow"];

/** Screen position of a world point in a view. */
function project(view: ViewPlan, p: readonly [number, number, number]): [number, number] {
  const { r, u } = basis(view.camera);
  return [view.ox + view.scale * dot3(p, r), view.oy - view.scale * dot3(p, u)];
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const rounded = (plans: unknown) => JSON.stringify(plans, (_key, value) => (typeof value === "number" ? round(value) : value));

test("the stored plans are the plans of the motion model and the cameras as they are now", () => {
  assert.equal(rounded(PLANS), rounded(computePlans()), "src/lib/lift-plans.ts is out of date: run `npm run lift:plans`");
});

test("the floor is one level rule at the soles of the planted feet: no foot, at any moment of the reps, is below it, and the near foot rests on it", () => {
  for (const size of SIZES) for (const kind of LIFT_KINDS) {
    const main = stageFor(kind, size).views[0];
    const set = makeLiftSet(kind, { reps: 2 });
    const reps = repSegments(set.timeline);
    let lowest = -Infinity;
    for (let t = reps[0].start; t <= reps[reps.length - 1].end; t += 0.05) {
      const pose = set.pose(t);
      for (const side of ["R", "L"] as const) for (const q of [pose.heel[side], pose.toe[side]]) {
        const y = project(main, [q[0], 0, q[2]])[1];
        assert.ok(y <= main.ground.y + 0.5, `${kind} ${size} t=${t.toFixed(2)}: a foot ${(y - main.ground.y).toFixed(1)} px below the floor rule`);
        lowest = Math.max(lowest, y);
      }
    }
    assert.ok(main.ground.y - lowest < 1.5, `${kind} ${size}: the feet stand ${(main.ground.y - lowest).toFixed(1)} px above the rule`);
    assert.ok(main.ground.x0 <= 0 && main.ground.x1 >= main.panel[2] - 1e-6, `${kind} ${size}: the rule spans the main panel`);
  }
});

test("on a desk both views have one scale (a metre, a plate, is as long in both) and stand on one floor rule that runs across the stage", () => {
  for (const kind of LIFT_KINDS) {
    const stage = stageFor(kind, "wide");
    const [main, front] = stage.views;
    assert.equal(main.scale, front.scale);
    assert.equal(main.ground.y, front.ground.y);
    assert.equal(project(front, [0, 0, 0])[1], front.ground.y);
    assert.ok(Math.abs(main.ground.x1 - front.ground.x0) < 1e-6 && front.ground.x1 === stage.width, `${kind}: the two rules are one rule`);
    // the column head stands just under the rule
    assert.ok(front.label!.y > front.ground.y && front.label!.y - front.ground.y <= 20);
  }
  for (const kind of LIFT_KINDS) {
    const [main, front] = stageFor(kind, "narrow").views;
    assert.ok(front.scale < main.scale, "on a phone the front view is a strip at the scale it allows");
    assert.ok(front.ground.y > main.panel[3], "its rule is in the strip");
  }
});

test("the stage has room for the page: a desk stays within 400 units, a phone within 432 with a front strip of 132; the lifts share one size and one scale", () => {
  for (const kind of LIFT_KINDS) {
    const wide = stageFor(kind, "wide"), narrow = stageFor(kind, "narrow");
    assert.ok(wide.height <= MAX_HEIGHT.wide, `${kind} wide ${wide.height}`);
    assert.ok(narrow.height <= MAX_HEIGHT.narrow, `${kind} narrow ${narrow.height}`);
    assert.equal(narrow.views[1].panel[3] - narrow.views[1].panel[1], STRIP_HEIGHT);
    // on a desk the two panels share the width; on a phone each takes all of it
    assert.equal(wide.views[0].panel[2], wide.views[1].panel[0]);
    assert.equal(wide.views[1].panel[2], wide.width);
    assert.equal(narrow.views[1].panel[2] - narrow.views[1].panel[0], narrow.width);
    assert.equal(narrow.views[0].panel[2] - narrow.views[0].panel[0], narrow.width);
  }
  for (const size of SIZES) {
    const stages = LIFT_KINDS.map((kind) => stageFor(kind, size));
    for (const view of [0, 1]) assert.equal(new Set(stages.map((s) => `${s.width}x${s.height}/${s.views[view].scale.toFixed(3)}/${s.views[view].panel}`)).size, 1, `${size}: the lifter and the stage are the same in every tab`);
  }
});

test("each lifter is big enough to read, at his tallest: the main view 230 px on a desk and 200 on a phone, the front view 190 and 110", () => {
  for (const size of SIZES) for (const kind of LIFT_KINDS) {
    const set = makeLiftSet(kind, { reps: 1 });
    const stage = stageFor(kind, size);
    for (const view of stage.views) {
      let head = 0;
      for (const { pose } of samplePoses(set, 200)) head = Math.max(head, pose.head[1] + 0.108);
      // the standing height of the lifter: head to floor, the figure itself (a bench lifter lies down: use his standing height of 1.75 m)
      const standing = Math.max(head, 1.75) * view.scale;
      const want = view.id === "front" ? (size === "wide" ? 190 : 110) : size === "wide" ? 230 : 200;
      assert.ok(standing >= want, `${kind} ${size} ${view.id}: figure ${standing.toFixed(0)} px < ${want}`);
    }
  }
});

test("the drawing has no measurements: the only words in it are the column head Front", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) {
    const set = makeLiftSet(kind, { reps: 1 });
    const d = drawLift({ pose: set.pose(set.heroTime), scene: set.scene, plates: platesPerSide(100) ?? [], stage: stageFor(kind, size) });
    assert.deepEqual(d.prims.filter((p) => p.el === "text").map((p) => p.text), ["Front"], `${kind} ${size}`);
  }
});

test("the front view shows the bar, the bench top and the floor rule, not the rack or the bench legs", () => {
  for (const kind of LIFT_KINDS) {
    const set = makeLiftSet(kind, { reps: 1 });
    const d = drawLift({ pose: set.pose(set.heroTime), scene: set.scene, plates: platesPerSide(100) ?? [], stage: stageFor(kind, "wide") });
    const front = d.prims.filter((p) => p.view === "front");
    assert.equal(front.filter((p) => p.part === "rack").length, 0, `${kind}: rack in the front view`);
    assert.ok(front.every((p) => !/bench-leg|bench-foot/.test(p.id)));
    assert.equal(front.some((p) => p.id === "front-bench-pad"), set.scene.family === "bench");
    assert.ok(front.some((p) => p.id === "front-floor"));
    assert.equal(d.prims.some((p) => p.view === "main" && p.part === "rack"), set.scene.rack !== null);
  }
});

test("the hairline between the views stands from just above the front figure to the floor rule (a desk) and runs across the stage (a phone)", () => {
  for (const kind of LIFT_KINDS) {
    const wide = stageFor(kind, "wide"), narrow = stageFor(kind, "narrow");
    const front = wide.views[1];
    assert.equal(wide.divider.x0, wide.divider.x1);
    assert.equal(wide.divider.y1, front.ground.y, `${kind}: it ends on the floor rule`);
    assert.ok(wide.divider.y0 <= front.extent[1] && wide.divider.y0 >= front.extent[1] - 12, `${kind}: it starts ${(front.extent[1] - wide.divider.y0).toFixed(1)} px above the front figure`);
    assert.equal(narrow.divider.y0, narrow.divider.y1);
    assert.equal(narrow.divider.y0, narrow.views[1].panel[1]);
  }
});

test("the main view is left-aligned with the text column and trimmed: what a set draws reaches to within a few px of the top of the stage", () => {
  for (const size of SIZES) {
    let highest = Infinity;
    for (const kind of LIFT_KINDS) {
      const stage = stageFor(kind, size);
      const [x0, y0, x1, y1] = stage.views[0].extent;
      assert.ok(x0 >= 0 && x0 <= 12, `${kind} ${size}: the drawing starts at x=${x0.toFixed(1)}`);
      assert.ok(x1 <= stage.views[0].panel[2] + 1e-6, `${kind} ${size}: the drawing ends at x=${x1.toFixed(1)}`);
      assert.ok(y0 >= 0 && y1 <= stage.views[0].panel[3] + 1e-6, `${kind} ${size}: extent ${y0.toFixed(1)}..${y1.toFixed(1)}`);
      // The bench is the low lift: its bar at lockout is 1.11 m up (the shoulders are set back on the pad and the hands are 0.76 m apart), so it
      // alone leaves a quarter of the stage empty above it. The standing lifts fill theirs.
      const bench = liftFamily(kind) === "bench";
      assert.ok(y0 <= (size === "wide" ? (bench ? 100 : 30) : (bench ? 80 : 25)), `${kind} ${size}: ${y0.toFixed(0)} px of air above the drawing`);
      highest = Math.min(highest, y0);
    }
    assert.ok(highest <= 8, `${size}: the tallest lift has ${highest.toFixed(1)} px of air`);
  }
});

test("the cameras: squat and deadlift are seen from the side (54 to 75 degrees round from the front: further round and the near plate covers the near hand), the bench from the side and the head end, low", () => {
  for (const family of ["squat", "deadlift"] as const) {
    const { az, el } = CAMERAS[family].main;
    assert.ok(az >= 54 && az <= 75 && el >= 4 && el <= 14, `${family}: ${az}/${el}`);
  }
  const bench = CAMERAS.bench.main;
  assert.ok(bench.az > 100 && bench.az < 150 && bench.el >= 4 && bench.el <= 14, `bench ${bench.az}/${bench.el}`);
});

test("the near plate stack does not cover what matters at the resting still: the near hand is clear of the plates and the bar shows between them", () => {
  for (const kind of LIFT_KINDS) {
    const set = makeLiftSet(kind, { reps: 2 });
    const main = stageFor(kind, "wide").views[0];
    const { r, u } = basis(main.camera);
    const pose = set.pose(set.heroTime);
    const hand = project(main, pose.hand.R);
    // The innermost near plate of the biggest kind (0.45 m) at z = 0.67, as an ellipse on the screen (a disc whose axis is the bar).
    const centre = project(main, [pose.bar[0], pose.bar[1], 0.67]);
    const ax = 0.225 * Math.hypot(r[0], r[1]) * main.scale, ay = 0.225 * Math.hypot(u[0], u[1]) * main.scale;
    const q = ((hand[0] - centre[0]) / ax) ** 2 + ((hand[1] - centre[1]) / ay) ** 2;
    assert.ok(q > 1.0, `${kind}: the near hand lies under the near plate (${q.toFixed(2)})`);
    // the bar is seen between the plates: its shaft is longer on the screen than a plate's face
    const left = project(main, [pose.bar[0], pose.bar[1], -0.655]), right = project(main, [pose.bar[0], pose.bar[1], 0.655]);
    assert.ok(Math.hypot(left[0] - right[0], left[1] - right[1]) > 0.45 * main.scale * 0.8, `${kind}: the shaft is foreshortened to nothing`);
  }
});

/** What differs on the screen between the lifts of a pair, in pixels (a desk) or degrees, at the resting still, in the main view alone and in the front view. */
function stillMeasures(kind: (typeof LIFT_KINDS)[number], view: 0 | 1) {
  const set = makeLiftSet(kind, { reps: 2 });
  const plan = stageFor(kind, "wide").views[view];
  const pose = set.pose(set.heroTime);
  const at = (p: readonly [number, number, number]) => project(plan, p);
  const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lean = (() => { const a = at(pose.pelvis), b = at(pose.chest); return (Math.atan2(Math.abs(b[0] - a[0]), a[1] - b[1]) * 180) / Math.PI; })();
  return { lean, hands: d(at(pose.hand.R), at(pose.hand.L)), feet: d(at(pose.heel.R), at(pose.heel.L)), handToShoulder: Math.abs(at(pose.hand.R)[0] - at(pose.shoulder.R)[0]) };
}

test("a pair is told apart in the main view alone, at the resting still: low bar leans more, close grip has the hands nearer the shoulders, sumo has the feet further apart", () => {
  const low = stillMeasures("squat-low", 0), high = stillMeasures("squat-high", 0);
  assert.ok(low.lean - high.lean >= 8, `lean on the screen: low ${low.lean.toFixed(1)}, high ${high.lean.toFixed(1)} degrees`);
  const bench = stillMeasures("bench", 0), close = stillMeasures("bench-close", 0);
  assert.ok(bench.hands - close.hands >= 12, `hands apart on the screen: bench ${bench.hands.toFixed(0)}, close grip ${close.hands.toFixed(0)} px`);
  assert.ok(bench.handToShoulder - close.handToShoulder >= 8, `hand to shoulder on the screen: bench ${bench.handToShoulder.toFixed(0)}, close grip ${close.handToShoulder.toFixed(0)} px`);
  const conv = stillMeasures("deadlift-conventional", 0), sumo = stillMeasures("deadlift-sumo", 0);
  assert.ok(sumo.feet - conv.feet >= 25, `heels apart on the screen: sumo ${sumo.feet.toFixed(0)}, conventional ${conv.feet.toFixed(0)} px`);
});

test("the front view tells the bench from the close grip by the hands, 20 px or more apart on a desk, and the forearms stand clear of the shins", () => {
  const bench = stillMeasures("bench", 1), close = stillMeasures("bench-close", 1);
  assert.ok(bench.hands - close.hands >= 20, `hands apart in the front view: bench ${bench.hands.toFixed(0)}, close grip ${close.hands.toFixed(0)} px`);
});
