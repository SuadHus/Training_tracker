// The drawing of a lifter lifting a loaded barbell, as data. PURE: no DOM, no clock, no random.
//
//   drawLift({ pose, scene, plates, stage }) -> { width, height, prims }
//
// `prims` is an ordered list (back to front) of flat shapes, each with a stable id, an SVG element name, its
// attributes (numbers rounded to one decimal) and a class name. The same function draws the first frame on the
// server and every frame in the browser. Colour lives in classes (`app/globals.css`), never here.
//
// Painting order: the stage (floor rule, rack, bench) first; then everything that moves, each part at a depth
// fixed for the lift and the camera (the plan's ranks), with a few deliberate biases (the bar lies behind a squatter's neck,
// in front of a deadlifter's legs); then the column head and the hairline.

import type { LiftPose, LiftScene, Vec3 } from "./lift-pose";
import { BAR } from "./lift-pose";
import { basis, dot3, nearSide, rackTop, type StagePlan, type ViewPlan } from "./lift-camera";
import { capsuleSub, circleSub, discHullSub, ellipseSub, fmt, hullSub, type P2 } from "./lift-geometry";
import { plateLook } from "./plate-look";

export type Part = "floor" | "rack" | "bench" | "block" | "leg" | "torso" | "head" | "arm" | "shaft" | "flange" | "plate" | "face" | "collar" | "sleeve" | "label" | "rule";

export type Prim = {
  /** Stable for a given set and stage: the same ids in every frame. */
  id: string;
  el: "path" | "text";
  /** Class names, space separated. Colour comes from them. */
  cls: string;
  part: Part;
  attrs: Record<string, string>;
  /** Content of a `text` element. */
  text?: string;
  /** Plates: which sleeve, and how far from the collar-less end (0 = the heaviest, next to the shoulder of the sleeve). */
  side?: "R" | "L";
  index?: number;
  /** The view this belongs to. */
  view: string;
};

export type Drawing = { width: number; height: number; viewBox: string; prims: Prim[] };

export type DrawInput = {
  pose: LiftPose;
  scene: LiftScene;
  /** The plates on one sleeve, heaviest first (`platesPerSide`). */
  plates: readonly number[];
  stage: StagePlan;
  /** Optional: remembers the outlines of the bar assembly between frames. The output is the same with or without it, whatever it has seen before. */
  memo?: BarMemo;
};

export type BarMemo = Map<string, BarPiece[]>;
/** A fresh memo for the bar assembly: one per stage on the page, for as long as it lives. */
export const makeMemo = (): BarMemo => new Map();

// ------------------------------------------------------------------ the mannequin's mass, in metres (radii)
const R = {
  hip: 0.1, thigh: 0.092, thighMid: 0.088, knee: 0.062, calf: 0.064, ankle: 0.036, heel: 0.044, ball: 0.034, toe: 0.026,
  shoulder: 0.062, upper: 0.054, elbow: 0.05, forearm: 0.042, wrist: 0.032, mitt: 0.04,
  pelvis: 0.104, waist: 0.08, ribs: 0.118, shoulderBall: 0.072, neck: 0.046, skull: 0.108, nose: 0.034,
};

/** Where along the bar each piece of the shaft sits for the paint order, whatever the grip. */
/** Screen width (px) under which a plate is too thin to carry an outline. */
const THIN_PLATE = 2.6;

const SHAFT_KEY_Z: Record<string, number> = { "shaft-L": -0.47, "shaft-mid": 0, "shaft-R": 0.47 };

type Entry = { prim: Prim; layer: number; view: number; key: number; seq: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The drawing of one instant: every shape of both views, back to front. */
export function drawLift(input: DrawInput): Drawing {
  const entries: Entry[] = [];
  let seq = 0;
  input.stage.views.forEach((view, index) => drawView(view, index, input, entries, () => seq++));
  // Each view is painted whole, one after the other: the depth of one view means nothing in the other.
  entries.sort((a, b) => a.view - b.view || a.layer - b.layer || a.key - b.key || a.seq - b.seq);
  const { width, height } = input.stage;
  return { width, height, viewBox: `0 0 ${width} ${height}`, prims: entries.map((entry) => entry.prim) };
}

function drawView(view: ViewPlan, viewIndex: number, input: DrawInput, out: Entry[], next: () => number): void {
  const { pose, scene, plates, stage } = input;
  const { r, u, c } = basis(view.camera);
  const s = view.scale;
  const P = (p: Vec3): P2 => [view.ox + s * dot3(p, r), view.oy - s * dot3(p, u)];
  const depth = (p: Vec3) => dot3(p, c);
  const near = nearSide(view.camera.az);
  const family = scene.family;
  const id = (name: string) => `${view.id}-${name}`;
  const push = (layer: number, key: number, prim: Omit<Prim, "view">) => out.push({ prim: { ...prim, id: id(prim.id), view: view.id }, layer, view: viewIndex, key: Math.round(key * 1e5) / 1e5, seq: next() });
  const tone = (side: "R" | "L") => (near === null || near === side ? "lf-ink" : "lf-far");
  // Seen from the head end the legs of a bench lifter stand beside his forearms: they take the quieter tone, so that an arm is told from a shin.
  const legTone = (side: "R" | "L") => (family === "bench" && near === null ? "lf-far" : tone(side));

  // ---------------------------------------------------------------- the stage: floor rule, rack, bench, blocks
  const elevation = view.id === "front";
  const { ground } = view;
  push(0, -1e9, { id: "floor", el: "path", cls: "lf-floor", part: "floor", attrs: { d: `M${fmt(ground.x0)} ${fmt(ground.y)}L${fmt(ground.x1)} ${fmt(ground.y)}` } });

  const boxHull = (name: string, part: Part, cls: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, key: number) => {
    const pts: P2[] = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(P([x, y, z]));
    const hull = hullSub(pts.map((p) => [p, 0] as const));
    push(0, key, { id: name, el: "path", cls, part, attrs: { d: hull } });
  };
  const boxKey = (x: number, y: number, z: number) => depth([x, y, z]);

  if (scene.rack && !elevation) {
    const k = scene.rack;
    const sign = family === "bench" ? -1 : 1;
    for (const side of ["L", "R"] as const) {
      const z = (side === "R" ? 1 : -1) * k.halfWidth;
      boxHull(`rack-post-${side}`, "rack", "lf-frame", k.x - 0.025, k.x + 0.025, 0, rackTop(k), z - 0.025, z + 0.025, boxKey(k.x, rackTop(k) / 2, z));
      boxHull(`rack-hook-${side}`, "rack", "lf-frame", k.barX - sign * 0.04, k.barX + sign * 0.05, k.barY - 0.03, k.barY, z - 0.035, z + 0.035, boxKey(k.barX, k.barY, z) + 0.01);
    }
  }
  if (scene.bench) {
    const b = scene.bench;
    if (!elevation) for (const [i, x] of [b.headX + 0.2, b.footX - 0.2].entries()) boxHull(`bench-leg-${i}`, "bench", "lf-frame", x - 0.03, x + 0.03, 0, b.top - 0.1, -0.03, 0.03, boxKey(x, 0.2, 0));
    boxHull("bench-pad", "bench", "lf-pad", b.headX, b.footX, b.top - 0.1, b.top, -b.halfWidth, b.halfWidth, boxKey((b.headX + b.footX) / 2, b.top - 0.05, 0) + 0.02);
  }
  if (scene.barRestY !== null) {
    const biggest = plates.length ? Math.max(...plates.map((kg) => plateLook(kg).diameter)) / 2 : BAR.sleeveRadius;
    const h = scene.barRestY - biggest;
    if (h > 0.004) {
      for (const side of ["L", "R"] as const) {
        const z = (side === "R" ? 1 : -1) * 0.86;
        boxHull(`block-${side}`, "block", "lf-frame", pose.bar[0] - 0.17, pose.bar[0] + 0.17, 0, h, z - 0.16, z + 0.16, boxKey(pose.bar[0], h / 2, z));
      }
    }
  }

  // ---------------------------------------------------------------- the bar: shaft, sleeves, plates, collars
  // The bar and its plates are rigid: in a parallel projection moving them is a translation of the screen. Their
  // outlines are worked out once (relative to the bar's centre) and every frame only carries a `transform`.
  const bar = pose.bar;
  // Seen end-on (a side elevation) the plates would hide the lifter: they are drawn behind it, as on a technical drawing.
  // The bar itself (shaft, sleeve end, collar) stays in front, so that the height of the bar shows through the plate.
  const endOn = Math.abs(c[2]) > 0.97;
  // The shaft is cut at the hands, to the millimetre: the cut is part of what the memo keys on, so the output never depends on what was drawn before.
  const gz = Math.round(Math.max(Math.abs(pose.hand.R[2]), Math.abs(pose.hand.L[2]), 0.1) * 1000) / 1000;
  const midBias = family === "squat" ? -0.3 * Math.sign(c[0]) : family === "deadlift" ? 0.2 * Math.sign(c[0]) : 0.05;
  const shift = P(bar);
  const transform = `translate(${fmt(shift[0])} ${fmt(shift[1])})`;
  // The bar's place in the paint order is the same in every frame (the plan's mean), so that it never swaps with a limb.
  const barDepth = view.barDepth;
  for (const piece of barPieces(view, r, u, c, plates, gz, midBias, input.memo)) {
    // The shaft is cut at the hands; where it is cut moves with them, but its place in the paint order must not.
    const keyZ = piece.part === "shaft" ? SHAFT_KEY_Z[piece.id] ?? piece.z : piece.z;
    push(1, barDepth + c[2] * keyZ + piece.bias + (endOn && (piece.part === "plate" || piece.part === "face" || piece.part === "flange") ? -1000 : 0), {
      id: piece.id, el: "path", cls: piece.cls, part: piece.part, attrs: { d: piece.d, transform }, side: piece.side, index: piece.index,
    });
  }

  // ---------------------------------------------------------------- the mannequin
  const body = (name: string, part: Part, cls: string, d: string, key: number, side?: "R" | "L") =>
    push(1, key, { id: name, el: "path", cls: `lf-body ${cls}`, part, attrs: { d }, side });
  const C = (p: Vec3, radius: number): readonly [P2, number] => [P(p), radius * s];
  const cap = (a: Vec3, ra: number, b: Vec3, rb: number) => capsuleSub(P(a), ra * s, P(b), rb * s);
  const ball = (p: Vec3, radius: number) => circleSub(P(p), radius * s);

  // Where the torso sits along the line of sight. A limb on the camera's side is painted after it, one on the far side
  // before it, whatever its own depth says: that is what stops them swapping from frame to frame.
  const rank = view.ranks;

  for (const side of ["R", "L"] as const) {
    const hip = pose.hip[side], knee = pose.knee[side], ankle = pose.ankle[side], heel = pose.heel[side], toe = pose.toe[side];
    const soleDir = norm(sub(toe, heel));
    const up = norm(sub(ankle, mix(heel, toe, 0.23)));
    // The foot is a wedge: a round heel behind the ankle, the ball of the foot, a lower toe. The heel and the toe both read.
    const heelC = add(add(heel, mul(soleDir, R.heel)), mul(up, R.heel));
    const ballC = add(mix(heel, toe, 0.7), mul(up, R.ball));
    const toeC = add(sub(toe, mul(soleDir, R.toe)), mul(up, R.toe));
    const thighMid = mix(hip, knee, 0.45), calf = mix(knee, ankle, 0.3);
    const d = cap(hip, R.thigh, thighMid, R.thighMid) + cap(thighMid, R.thighMid, knee, R.knee) + cap(knee, R.knee, calf, R.calf) + cap(calf, R.calf, ankle, R.ankle) +
      hullSub([C(heelC, R.heel), C(ankle, R.ankle), C(ballC, R.ball), C(toeC, R.toe)]);
    body(`leg-${side}`, "leg", legTone(side), d, rank[`leg-${side}`], side);
  }

  // The direction the lifter faces, from his spine and shoulder line (up, on a bench).
  const spine = norm(sub(pose.chest, pose.pelvis));
  const facing = norm(cross(spine, norm(sub(pose.shoulder.R, pose.shoulder.L))));

  // Torso: a pelvis and a chest, each the hull of its balls, joined at a waist that is narrower than the hips and the ribs.
  {
    const ribs = add(mix(pose.waist, pose.chest, 0.55), mul(facing, 0.01));
    // Seen from the front or the back the waist is two balls side by side, so the trunk tapers from the shoulders to the waist and out to the hips.
    const flat = near === null;
    const wz: Vec3 = [0, 0, 0.066];
    const waistBalls = flat ? [C(add(pose.waist, wz), R.waist), C(sub(pose.waist, wz), R.waist)] : [C(pose.waist, R.waist)];
    const seat = C(sub(pose.pelvis, mul(facing, 0.03)), R.pelvis);
    const lower = hullSub([C(pose.hip.R, R.hip), C(pose.hip.L, R.hip), seat, ...waistBalls, C(pose.pelvis, R.pelvis)]);
    const upper = hullSub([...waistBalls, C(ribs, R.ribs), C(pose.shoulder.R, R.shoulderBall), C(pose.shoulder.L, R.shoulderBall), C(pose.chest, R.shoulderBall), C(add(pose.chest, mul(norm(sub(pose.chest, pose.waist)), 0.05)), 0.074)]);
    body("torso", "torso", "lf-torso", lower + upper, rank.torso);
  }

  // Head and neck. The head faces a way: a small brow and nose in the outline, nothing more.
  {
    const axis = norm(sub(pose.head, pose.chest));
    const face: Vec3 = [axis[1], -axis[0], 0];
    const back = sub(pose.head, mul(face, 0.01)), front = add(pose.head, mul(face, 0.016));
    const nose = sub(add(pose.head, mul(face, 0.12)), mul(axis, 0.016));
    const root = add(pose.chest, mul(norm(sub(pose.chest, pose.waist)), 0.02));
    const d = cap(root, R.neck, sub(pose.head, mul(axis, 0.03)), R.neck - 0.004) + cap(back, R.skull, front, R.skull - 0.003) + ball(nose, R.nose);
    // On a standing lifter the head goes under the torso: its neck then rises out of the shoulders instead of being cut off by a halo.
    body("head", "head", "lf-head", d, rank.head);
  }

  // Arms: shoulder, upper arm, forearm, and a small mitt that closes round the bar (its long way along the bar).
  for (const side of ["R", "L"] as const) {
    const sh = pose.shoulder[side], el = pose.elbow[side], wr = pose.wrist[side], hand = pose.hand[side];
    const along: Vec3 = pose.gripping ? [0, 0, 0.026] : mul(norm(sub(hand, wr)), 0.02);
    const mitt = cap(sub(hand, along), R.mitt, add(hand, along), R.mitt);
    const d = ball(sh, R.shoulder) + cap(sh, R.upper, el, R.elbow) + cap(el, R.forearm, wr, R.wrist) + cap(wr, R.wrist, hand, R.mitt - 0.004) + mitt;
    body(`arm-${side}`, "arm", tone(side), d, rank[`arm-${side}`], side);
  }

  // ---------------------------------------------------------------- the column head, and the hairline between the views
  if (view.label) push(2, 0, { id: "label", el: "text", cls: "lf-label", part: "label", attrs: { x: fmt(view.label.x), y: fmt(view.label.y) }, text: view.label.text });
  if (view.id === "front") {
    const { x0, y0, x1, y1 } = stage.divider;
    push(2, 1, { id: "rule", el: "path", cls: "lf-divider", part: "rule", attrs: { d: `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}` } });
  }
}

export type BarPiece = { id: string; cls: string; part: Part; d: string; z: number; bias: number; side?: "R" | "L"; index?: number };

/**
 * Every outline of the bar assembly (shaft pieces, sleeve flanges, plates and their faces, collars, sleeve ends) in
 * screen units relative to the bar's centre, with the z of each along the bar. Memoised on everything they depend on: the
 * scale and camera of the view, the plates, the cut of the shaft and its paint bias.
 */
function barPieces(view: ViewPlan, r: Vec3, u: Vec3, c: Vec3, plates: readonly number[], gz: number, midBias: number, memo?: BarMemo): BarPiece[] {
  const key = `${view.scale}|${view.camera.az}|${view.camera.el}|${plates.join(",")}|${gz}|${midBias}`;
  const hit = memo?.get(key);
  if (hit) return hit;
  const s = view.scale;
  const facing = c[2];
  const zAxis: P2 = [s * r[2], -s * u[2]]; // the world z axis on the screen, per metre
  const at = (z: number): P2 => [zAxis[0] * z, zAxis[1] * z];
  const disc = (zFrom: number, zTo: number, radius: number): string => {
    const mid = (zFrom + zTo) / 2, half = (zTo - zFrom) / 2;
    return discHullSub(at(mid), [zAxis[0] * half, zAxis[1] * half], radius * s, facing, zAxis);
  };
  const out: BarPiece[] = [];
  const shaftEnd = BAR.shaft / 2;
  const name = (n: string) => n;
  for (const [n, z0, z1, bias] of [["shaft-L", -shaftEnd, -gz, 0], ["shaft-mid", -gz, gz, midBias], ["shaft-R", gz, shaftEnd, 0]] as const) {
    out.push({ id: name(n), cls: "bar-steel", part: "shaft", d: disc(z0, z1, BAR.shaftRadius), z: (z0 + z1) / 2, bias });
  }
  // Plates: thickness is exaggerated; a stack that would not fit on the sleeve is compressed to fit.
  const gap = 0.003, flange = 0.014, collar = BAR.collar;
  const room = BAR.sleeve - flange - collar - 0.012;
  const raw = plates.reduce((total, kg) => total + plateLook(kg).thickness + gap, 0);
  const squeeze = raw > room ? room / raw : 1;
  const major = Math.hypot(zAxis[0], zAxis[1]) > 1e-6 ? Math.atan2(zAxis[0], -zAxis[1]) : 0;
  for (const side of ["L", "R"] as const) {
    const sg = side === "R" ? 1 : -1;
    const range = (a: number, b: number): [number, number] => (sg > 0 ? [a, b] : [-b, -a]);
    {
      const [a, b] = range(shaftEnd, shaftEnd + flange);
      out.push({ id: name(`flange-${side}`), cls: "bar-steel", part: "flange", d: disc(a, b, 0.034), z: sg * (shaftEnd + flange / 2), bias: 0, side });
    }
    let cursor = shaftEnd + flange + 0.002;
    plates.forEach((kg, index) => {
      const look = plateLook(kg);
      const thick = look.thickness * squeeze;
      const [a, b] = range(cursor, cursor + thick);
      const z = sg * (cursor + thick / 2);
      // A plate thinner than this on the screen keeps no outline: the outline would take all of its colour.
      const thin = thick * s * Math.hypot(r[2], u[2]) < THIN_PLATE;
      out.push({ id: name(`plate-${side}-${index}`), cls: `lf-plate ${look.cls}${thin ? " lf-thin" : ""}`, part: "plate", d: disc(a, b, look.diameter / 2), z, bias: 0, side, index });
      // The face that looks at the camera, drawn as a thin rim line.
      const faceZ = sg * (cursor + (sg * facing >= 0 ? thick : 0));
      out.push({
        id: name(`face-${side}-${index}`), cls: "lf-face", part: "face", z, bias: 1e-4, side, index,
        d: ellipseSub(at(faceZ), look.diameter * 0.43 * s, look.diameter * 0.43 * s * Math.abs(facing), major),
      });
      cursor += thick + gap * squeeze;
    });
    if (plates.length) {
      const [a, b] = range(cursor, cursor + collar);
      out.push({ id: name(`collar-${side}`), cls: "bar-steel", part: "collar", d: disc(a, b, 0.04), z: sg * (cursor + collar / 2), bias: 0, side });
      cursor += collar;
    }
    const sleeveEnd = shaftEnd + BAR.sleeve;
    const [a, b] = range(cursor, sleeveEnd);
    out.push({ id: name(`sleeve-${side}`), cls: "bar-steel", part: "sleeve", d: disc(a, b, BAR.sleeveRadius), z: sg * sleeveEnd, bias: 0, side });
  }
  if (memo) { if (memo.size > 64) memo.clear(); memo.set(key, out); }
  return out;
}

/** The SVG markup of a drawing as text, for tests that compare two drawings. */
export function toMarkup(prims: readonly Prim[]): string {
  const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return prims
    .map((prim) => {
      const attrs = Object.entries(prim.attrs).map(([name, value]) => ` ${name}="${esc(value)}"`).join("");
      return `<${prim.el} data-k="${prim.id}" class="${prim.cls}"${attrs}>${prim.text ? esc(prim.text) : ""}</${prim.el}>`;
    })
    .join("");
}
