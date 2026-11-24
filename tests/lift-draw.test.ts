import { test } from "node:test";
import assert from "node:assert/strict";
import { drawLift, makeMemo, toMarkup, type Drawing, type Prim } from "../src/lib/lift-draw";
import { makeLiftSet } from "../src/lib/lift-motion";
import { stageFor } from "../src/lib/lift-plan";
import { LIFT_KINDS, type LiftKind } from "../src/lib/lifts";
import { platesPerSide } from "../src/lib/workout-doc";
import { plateLook } from "../src/lib/plate-look";
import { basis, BODY_PARTS, nearSide } from "../src/lib/lift-camera";
import type { StageSize } from "../src/lib/lift-camera";

// ---------------------------------------------------------------- an independent reader of the path data
type Box = { x0: number; y0: number; x1: number; y1: number };
const grow = (b: Box, x: number, y: number) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); };

/** Bounds of absolute M, L, A, Z path data. An arc counts as its whole ellipse: a safe over-estimate. */
function pathBounds(d: string): Box {
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const tokens = d.match(/[MLAZ]|-?\d+(?:\.\d+)?/g) ?? [];
  let i = 0, cx = 0, cy = 0, command = "";
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLAZ]/.test(tokens[i])) command = tokens[i++];
    if (command === "Z") continue;
    if (command === "M" || command === "L") { cx = num(); cy = num(); grow(box, cx, cy); continue; }
    if (command === "A") {
      let rx = Math.abs(num()), ry = Math.abs(num());
      const phi = (num() * Math.PI) / 180, large = num(), sweep = num(), x = num(), y = num();
      const dx = (cx - x) / 2, dy = (cy - y) / 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
      const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
      if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
      const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
      const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
      const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (den || 1)));
      const cxp = (k * rx * y1) / ry, cyp = (-k * ry * x1) / rx;
      const ex = c * cxp - s * cyp + (cx + x) / 2, ey = s * cxp + c * cyp + (cy + y) / 2;
      const hx = Math.sqrt(rx * rx * c * c + ry * ry * s * s), hy = Math.sqrt(rx * rx * s * s + ry * ry * c * c);
      grow(box, ex - hx, ey - hy); grow(box, ex + hx, ey + hy);
      cx = x; cy = y; grow(box, cx, cy);
      continue;
    }
    throw new Error(`unexpected path command ${command} in ${d}`);
  }
  return box;
}

/** The sweeps below sample the whole timeline of every lift; by default a quarter as densely (seconds), with LIFT_SWEEP=1 as densely as they were written (minutes). */
const DENSITY = process.env.LIFT_SWEEP ? 1 : 0.25;

const SIZES: StageSize[] = ["wide", "narrow"];
const LOADS = [20, 60, 102.5, 182.5, 300, 820];
const REPS = [1, 2, 8];
const SAMPLES = 14;

function frames(kind: LiftKind, reps: number, loadKg: number, size: StageSize) {
  const set = makeLiftSet(kind, { reps });
  const plates = platesPerSide(loadKg) ?? [];
  const stage = stageFor(kind, size);
  const out: Array<{ t: number; drawing: Drawing }> = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (set.duration * i) / (SAMPLES - 1);
    out.push({ t, drawing: drawLift({ pose: set.pose(t), scene: set.scene, plates, stage }) });
  }
  return { set, plates, stage, out };
}

test("every load in the matrix can be made from plates", () => {
  for (const load of LOADS) assert.ok(platesPerSide(load), `${load} kg`);
  assert.equal(platesPerSide(820)!.length, 16);
});

for (const kind of LIFT_KINDS) {
  test(`${kind}: inside the view box, unique stable ids, no NaN, plates as loaded, far before near`, () => {
    for (const size of SIZES) for (const loadKg of LOADS) for (const reps of REPS) {
      const label = `${kind} ${size} ${loadKg} kg x ${reps}`;
      const { plates, stage, out } = frames(kind, reps, loadKg, size);
      const first = out[0].drawing;
      const ids = first.prims.map((prim) => prim.id);
      assert.equal(new Set(ids).size, ids.length, `${label}: ids unique`);
      for (const { t, drawing } of out) {
        assert.equal(drawing.width, stage.width);
        assert.equal(drawing.height, stage.height);
        assert.equal(drawing.viewBox, first.viewBox, `${label}: the view box never changes`);
        const here = drawing.prims.map((prim) => prim.id);
        assert.deepEqual([...here].sort(), [...ids].sort(), `${label} t=${t.toFixed(2)}: same ids in every frame`);
        for (const prim of drawing.prims) {
          const text = Object.values(prim.attrs).join(" ") + (prim.text ?? "");
          assert.ok(!/NaN|Infinity|undefined/.test(text), `${label}: ${prim.id} has ${text.slice(0, 80)}`);
          const slack = prim.part === "label" || prim.part === "rule" || prim.part === "floor" ? 0 : 1.5; // the halo of a body part reaches 1.5 px past its outline
          if (prim.el === "path") {
            const b = pathBounds(prim.attrs.d);
            const shift = /^translate\((-?[\d.]+) (-?[\d.]+)\)$/.exec(prim.attrs.transform ?? "translate(0 0)");
            assert.ok(shift, `${label}: ${prim.id} transform ${prim.attrs.transform}`);
            b.x0 += Number(shift![1]); b.x1 += Number(shift![1]); b.y0 += Number(shift![2]); b.y1 += Number(shift![2]);
            assert.ok(b.x0 >= slack - 1e-6 && b.y0 >= slack - 1e-6 && b.x1 <= stage.width - slack + 1e-6 && b.y1 <= stage.height - slack + 1e-6,
              `${label} t=${t.toFixed(2)}: ${prim.id} [${[b.x0, b.y0, b.x1, b.y1].map((v) => v.toFixed(1))}] outside ${stage.width}x${stage.height}`);
          } else {
            const x = Number(prim.attrs.x), y = Number(prim.attrs.y);
            assert.ok(x >= 0 && x <= stage.width && y >= 0 && y <= stage.height, `${label}: text ${prim.id} at ${x},${y}`);
          }
        }
        // numbers carry at most one decimal
        for (const prim of drawing.prims) assert.ok(!/\d\.\d\d/.test((prim.attrs.d ?? "") + (prim.attrs.transform ?? "")), `${label}: ${prim.id} rounds to one decimal`);

        // the plates on both sleeves are the plates of the load: count, order, class
        const wanted = plates.map((kg) => plateLook(kg).cls);
        for (const view of stage.views) {
          for (const side of ["R", "L"] as const) {
            const drawn = drawing.prims.filter((p) => p.part === "plate" && p.side === side && p.view === view.id).sort((a, b) => a.index! - b.index!);
            assert.deepEqual(drawn.map((p) => p.cls.split(" ").find((name) => /^p-/.test(name))), wanted, `${label}: ${view.id} ${side} plates`);
            assert.deepEqual(drawn.map((p) => p.index), wanted.map((_, i) => i));
          }
          // the far side is painted before the near side
          const near = nearSide(view.camera.az);
          if (near) {
            const far = near === "R" ? "L" : "R";
            const at = (side: "R" | "L") => here.map((id, i) => ({ id, i })).filter(({ id }) => id.startsWith(`${view.id}-plate-${side}-`) || id.startsWith(`${view.id}-collar-${side}`) || id.startsWith(`${view.id}-sleeve-${side}`)).map(({ i }) => i);
            const farAt = at(far), nearAt = at(near);
            if (farAt.length && nearAt.length) assert.ok(Math.max(...farAt) < Math.min(...nearAt), `${label} t=${t.toFixed(2)}: ${view.id} far sleeve before the near one`);
          }
        }
      }
    }
  });
}

test("a view box depends on the lift only, not on the load, the reps or the time; all lifts share one stage size", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) {
    const stage = stageFor(kind, size);
    const a = frames(kind, 1, 20, size).out[0].drawing.viewBox;
    const b = frames(kind, 8, 820, size).out[5].drawing.viewBox;
    assert.equal(a, b);
    assert.equal(a, `0 0 ${stage.width} ${stage.height}`);
  }
  for (const size of SIZES) {
    const sizes = new Set(LIFT_KINDS.map((kind) => `${stageFor(kind, size).width}x${stageFor(kind, size).height}`));
    assert.equal(sizes.size, 1, `all lifts share one stage size in ${size}`);
    const scales = new Set(LIFT_KINDS.map((kind) => stageFor(kind, size).views[0].scale.toFixed(3)));
    assert.equal(scales.size, 1, `the lifter is as big in every tab (${size})`);
  }
});

test("pure: the same input draws the same output and the input is left alone", () => {
  for (const kind of LIFT_KINDS) {
    const set = makeLiftSet(kind, { reps: 2 });
    const stage = stageFor(kind, "wide");
    const input = { pose: set.pose(set.duration * 0.37), scene: set.scene, plates: platesPerSide(182.5)!, stage };
    const before = JSON.stringify(input);
    const one = drawLift(input), two = drawLift(input);
    assert.deepEqual(one, two);
    assert.equal(toMarkup(one.prims), toMarkup(two.prims));
    assert.equal(JSON.stringify(input), before);
  }
});

test("the paint order changes only where it must: plates keep their order from frame to frame", () => {
  for (const kind of LIFT_KINDS) {
    const { out } = frames(kind, 2, 182.5, "wide");
    const order = (d: Drawing, test: (p: Prim) => boolean) => d.prims.filter(test).map((p) => p.id).join();
    const plateOrder = order(out[0].drawing, (p) => p.part === "plate");
    for (const { drawing } of out) assert.equal(order(drawing, (p) => p.part === "plate"), plateOrder);
  }
});

test("cameras: a three-quarter view puts the right side nearer, a front view neither", () => {
  assert.equal(nearSide(38), "R");
  assert.equal(nearSide(0), null);
  assert.equal(nearSide(180), null);
  const { c } = basis({ az: 90, el: 0 });
  assert.ok(Math.abs(c[2] - 1) < 1e-9);
});

test("dense sampling: no frame of any lift leaves the view box, at the lightest and the heaviest bar", () => {
  const step = 1 / (20 * DENSITY);
  for (const kind of LIFT_KINDS) for (const loadKg of [20, 820]) {
    const set = makeLiftSet(kind, { reps: 2 });
    const plates = platesPerSide(loadKg)!;
    for (const size of SIZES) {
      const stage = stageFor(kind, size);
      for (let t = 0; t <= set.duration; t += step) {
        const drawing = drawLift({ pose: set.pose(t), scene: set.scene, plates, stage });
        for (const prim of drawing.prims) {
          if (prim.el !== "path") continue;
          const slack = prim.part === "rule" || prim.part === "floor" ? 0 : 1.5;
          const b = pathBounds(prim.attrs.d);
          const shift = /^translate\((-?[\d.]+) (-?[\d.]+)\)$/.exec(prim.attrs.transform ?? "translate(0 0)")!;
          const dx = Number(shift[1]), dy = Number(shift[2]);
          assert.ok(b.x0 + dx >= slack && b.y0 + dy >= slack && b.x1 + dx <= stage.width - slack && b.y1 + dy <= stage.height - slack,
            `${kind} ${size} ${loadKg} kg t=${t.toFixed(2)} ${prim.id}`);
        }
      }
    }
  }
});

test("the stage plan of every lift keeps the lifter inside with room to spare: no part comes closer than 4 px to the edge", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) {
    const set = makeLiftSet(kind, { reps: 1 });
    const stage = stageFor(kind, size);
    let closest = Infinity;
    for (let t = 0; t <= set.duration; t += 0.1) {
      const drawing = drawLift({ pose: set.pose(t), scene: set.scene, plates: [], stage });
      for (const prim of drawing.prims) {
        if (prim.part !== "leg" && prim.part !== "arm" && prim.part !== "head" && prim.part !== "torso") continue;
        const b = pathBounds(prim.attrs.d);
        closest = Math.min(closest, b.x0, b.y0, stage.width - b.x1, stage.height - b.y1);
      }
    }
    assert.ok(closest >= 4, `${kind} ${size}: closest approach ${closest.toFixed(1)}`);
  }
});

// ---------------------------------------------------------------- purity: the memo of the bar assembly
test("the memo changes nothing: every frame of every set, drawn in order through one memo, is the frame drawn with none", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) {
    const set = makeLiftSet(kind, { reps: 2 });
    const stage = stageFor(kind, size);
    const memo = makeMemo();
    const plates = platesPerSide(182.5)!;
    const steps = Math.round(set.duration * 60 * DENSITY);
    for (let i = 0; i <= steps; i++) {
      const t = (set.duration * i) / steps;
      const input = { pose: set.pose(t), scene: set.scene, plates, stage };
      assert.equal(JSON.stringify(drawLift({ ...input, memo })), JSON.stringify(drawLift(input)), `${kind} ${size} t=${t.toFixed(3)}`);
    }
  }
});

test("the memo never returns the plates of an earlier call: another load, another lift, the same memo", () => {
  const memo = makeMemo();
  for (const [kind, load] of [["squat-low", 300], ["squat-low", 60], ["bench", 60], ["bench", 20], ["deadlift-sumo", 820], ["squat-low", 300]] as const) {
    const set = makeLiftSet(kind, { reps: 1 });
    const input = { pose: set.pose(set.heroTime), scene: set.scene, plates: platesPerSide(load)!, stage: stageFor(kind, "wide") };
    assert.equal(toMarkup(drawLift({ ...input, memo }).prims), toMarkup(drawLift(input).prims), `${kind} ${load} kg`);
  }
});

// ---------------------------------------------------------------- paint order
const order = (d: Drawing, view: string) => { const ids = d.prims.map((p) => p.id); return BODY_PARTS.map((n) => ids.indexOf(`${view}-${n}`)); };

test("the paint order of the limbs is fixed for a lift and a camera: no pair of body parts ever swaps, in any view, at 40 frames a second", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) {
    const set = makeLiftSet(kind, { reps: 2 });
    const stage = stageFor(kind, size);
    const first: Record<string, number[]> = {};
    const steps = Math.round(set.duration * 40 * DENSITY);
    for (let i = 0; i <= steps; i++) {
      const d = drawLift({ pose: set.pose((set.duration * i) / steps), scene: set.scene, plates: platesPerSide(100) ?? [], stage });
      for (const view of stage.views) {
        const cur = order(d, view.id);
        assert.ok(cur.every((at) => at >= 0), `${kind}: every body part is drawn`);
        const rank = (cur: number[]) => cur.map((at) => cur.filter((other) => other < at).length).join(",");
        first[view.id] ??= cur;
        assert.equal(rank(cur), rank(first[view.id]), `${kind} ${size} ${view.id} t=${((set.duration * i) / steps).toFixed(2)}: the order of the body parts changed`);
        if (view.id === "main") assert.ok(cur[2] > cur[4], `${kind}: the near arm (R) is painted after the torso`);
      }
    }
  }
});

test("the head is under the torso of a standing lifter (the neck rises out of the shoulders) and over the torso of a bench lifter seen from his head end", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) {
    const set = makeLiftSet(kind, { reps: 1 });
    const d = drawLift({ pose: set.pose(set.heroTime), scene: set.scene, plates: [], stage: stageFor(kind, size) });
    for (const view of ["main", "front"]) {
      const [, , , , torso, head] = order(d, view);
      const camera = stageFor(kind, size).views.find((v) => v.id === view)!.camera;
      const nearer = set.scene.family === "bench" && (camera.az > 100);
      assert.equal(head > torso, nearer, `${kind} ${size} ${view}: head ${head}, torso ${torso}`);
    }
  }
});

const MOVING_PARTS = new Set(["leg", "torso", "head", "arm", "shaft", "flange", "plate", "face", "collar", "sleeve"]);

test("the whole paint order is fixed: no two moving parts (limbs, torso, head, every piece of the bar) ever change places, over the whole timeline of every lift, 1, 2 and 8 reps, both sizes, light and heavy bar", () => {
  for (const kind of LIFT_KINDS) for (const size of SIZES) for (const reps of [1, 2, 8]) {
    const set = makeLiftSet(kind, { reps });
    const stage = stageFor(kind, size);
    const plates = platesPerSide(size === "wide" ? 300 : 20) ?? [];
    const steps = Math.round(set.duration * 30 * DENSITY);
    let first: string | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = (set.duration * i) / steps;
      const d = drawLift({ pose: set.pose(t), scene: set.scene, plates, stage });
      const seq = d.prims.filter((p) => MOVING_PARTS.has(p.part)).map((p) => p.id).join(" ");
      first ??= seq;
      if (seq !== first) {
        const a: string[] = first.split(" "), b: string[] = seq.split(" ");
        const at = b.findIndex((id: string, k: number) => id !== a[k]);
        assert.fail(`${kind} ${size} ${reps} reps t=${t.toFixed(2)}: the paint order changed (${b[at]} where ${a[at]} was)`);
      }
    }
  }
});

// ---------------------------------------------------------------- tones and plates
test("tones: near limbs ink, far limbs a step quieter, the torso quieter still, so that the arm in front of the torso reads; a bench lifter's legs seen from his head end are far-toned beside his ink arms", () => {
  for (const kind of LIFT_KINDS) {
    const set = makeLiftSet(kind, { reps: 1 });
    const d = drawLift({ pose: set.pose(set.heroTime), scene: set.scene, plates: [], stage: stageFor(kind, "wide") });
    const cls = (id: string) => d.prims.find((p) => p.id === id)!.cls.split(" ").pop();
    assert.equal(cls("main-arm-R"), "lf-ink");
    assert.equal(cls("main-leg-R"), "lf-ink");
    assert.equal(cls("main-arm-L"), "lf-far");
    assert.equal(cls("main-leg-L"), "lf-far");
    assert.equal(cls("main-torso"), "lf-torso");
    assert.equal(cls("main-head"), "lf-head");
    // the front view has no near side: both arms are ink, and so are both legs, except on the bench
    assert.equal(cls("front-arm-L"), "lf-ink");
    assert.equal(cls("front-leg-L"), set.scene.family === "bench" ? "lf-far" : "lf-ink");
    assert.equal(cls("front-leg-R"), set.scene.family === "bench" ? "lf-far" : "lf-ink");
  }
});

test("the 5, 2.5 and 1.25 kg plates are a tenth thicker than the site's plate widths give, the others are not", () => {
  const unit = 0.0085;
  const widths: Record<number, number> = { 25: 6, 20: 5, 15: 4.5, 10: 4, 5: 3, 2.5: 2.5, 1.25: 2 };
  for (const [kg, width] of Object.entries(widths)) {
    const ratio = plateLook(Number(kg)).thickness / (width * unit);
    assert.ok(Math.abs(ratio - (Number(kg) <= 5 ? 1.1 : 1)) < 1e-9, `${kg} kg: ${ratio}`);
  }
});

test("a plate too thin on the screen to carry an outline has none: the outline would take all its colour", () => {
  const kind = "squat-low", size = "narrow";
  const set = makeLiftSet(kind, { reps: 1 });
  const stage = stageFor(kind, size);
  const classes = (load: number) => drawLift({ pose: set.pose(set.heroTime), scene: set.scene, plates: platesPerSide(load)!, stage }).prims.filter((p) => p.part === "plate" && p.view === "front" && p.side === "R").map((p) => p.cls);
  assert.ok(classes(70).every((cls) => !cls.includes("lf-thin")), "a 25 kg plate keeps its outline on a phone");
  assert.ok(classes(820).every((cls) => cls.includes("lf-thin")), "sixteen plates, squeezed on the sleeve, are too thin to outline");
});
