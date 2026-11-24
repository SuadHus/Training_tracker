// Parallel projection, the two cameras of each lift and the fixed stage each lift is drawn on.
// Pure: no DOM, no clock.
//
// The stage is one large three-quarter view of the lifter (`main`) and a front elevation (`front`). On a desk they
// stand side by side at the same scale (a metre is as long in both, a plate as big) on one floor rule; on a phone the main
// view is on top at full width and the front view is a strip under it, at the scale its strip allows.

import { BAR, type LiftPose, type LiftScene, type Vec3 } from "./lift-pose";
import type { LiftFamily, LiftKind } from "./lifts";
import { plateLook } from "./plate-look";

/**
 * A camera on a circle round the lifter. `az` 0 looks at the lifter's front (the camera stands where the lifter
 * faces), 90 at the lifter's right side, 180 at the back. `el` is the height above the horizon. Degrees.
 */
export type Camera = { az: number; el: number };

export type Basis = { r: Vec3; u: Vec3; c: Vec3 };

const rad = Math.PI / 180;

/** Right, up and toward-the-camera unit vectors of a camera. */
export function basis(camera: Camera): Basis {
  const a = camera.az * rad, e = camera.el * rad;
  const c: Vec3 = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  const r: Vec3 = [Math.sin(a), 0, -Math.cos(a)];
  const u: Vec3 = [-Math.sin(e) * Math.cos(a), Math.cos(e), -Math.sin(e) * Math.sin(a)];
  return { r, u, c };
}

/** The dot product of two vectors. */
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The side of the lifter nearer the camera, or null when both are equally near (a front or back view). */
export function nearSide(az: number): "R" | "L" | null {
  const cz = Math.sin(az * rad);
  return cz > 0.15 ? "R" : cz < -0.15 ? "L" : null;
}

export type Family = LiftFamily;
export type StageSize = "wide" | "narrow";
export type ViewId = "main" | "front";
/** x0, y0, x1, y1 */
export type Box = readonly [number, number, number, number];

/** The six parts of the mannequin whose paint order is fixed for a lift and a camera. */
export type BodyPart = "leg-R" | "leg-L" | "arm-R" | "arm-L" | "torso" | "head";
export const BODY_PARTS: readonly BodyPart[] = ["leg-R", "leg-L", "arm-R", "arm-L", "torso", "head"];
export type BodyRanks = Record<BodyPart, number>;

export type ViewPlan = {
  id: ViewId;
  camera: Camera;
  /** Screen units per metre. */
  scale: number;
  /** Where the world origin lands on the stage. */
  ox: number;
  oy: number;
  /** The part of the stage this view owns. */
  panel: Box;
  /** Everything the set can draw in this view, as a box on the stage (the extent of the lifter, the bar and the floor). */
  extent: Box;
  /** The quiet column head under a view: baseline start. */
  label: { text: string; x: number; y: number } | null;
  /** The level ground rule the lifter stands on, from x0 to x1 at y. On a desk the two views' rules are one rule. */
  ground: { x0: number; x1: number; y: number };
  /**
   * The depth each body part is painted at, the same in every frame: a limb on the camera's side after the torso, one
   * on the far side before it, the rest by its mean depth over the whole set. Nothing swaps while the lift plays.
   */
  ranks: BodyRanks;
  /**
   * Where the bar is along the line of sight, for the paint order, the same in every frame (the mean over the set). The bar's
   * pieces are placed from it, so that the bar never changes places with a limb while the lift plays.
   */
  barDepth: number;
};

export type StagePlan = {
  size: StageSize;
  family: Family;
  width: number;
  height: number;
  views: ViewPlan[];
  /** The hairline between the two views, only as long as the drawing. */
  divider: { x0: number; y0: number; x1: number; y1: number };
};

/** The camera each family is drawn with. */
export const CAMERAS: Record<Family, Record<ViewId, Camera>> = {
  squat: { main: { az: 54, el: 8 }, front: { az: 0, el: 0 } },
  bench: { main: { az: 138, el: 13 }, front: { az: 180, el: 0 } },
  deadlift: { main: { az: 56, el: 8 }, front: { az: 0, el: 0 } },
};

/** One pose of a set. `working`: the lifter is at the bar, between the first rep's start and the last rep's end. */
export type ExtentSample = { pose: LiftPose; scene: LiftScene; working?: boolean };

/** Radii of the parts of the mannequin as the drawing makes them (a sphere projects to a circle of its own radius). */
const PAD = {
  hip: 0.1, knee: 0.068, ankle: 0.042, heel: 0.044, toe: 0.034, shoulder: 0.076, elbow: 0.05, wrist: 0.036, hand: 0.096,
  pelvis: 0.1, waist: 0.104, chest: 0.126, head: 0.13,
};

/** The reach of the biggest plate (the site's plate table says how big the 25 kg plate is), its face rim and the collar, in metres from the bar's axis. */
const PLATE_REACH = plateLook(25).diameter / 2 + 0.02;
const SLEEVE_REACH = 0.032;

/** The uprights stop a little above the hooks: the lifter and the bar need no more, and the stage no more air. */
export const rackTop = (rack: NonNullable<LiftScene["rack"]>) => Math.min(rack.height, rack.barY + 0.45);

/**
 * The bounds of everything a set can draw in one view, in metres on the view's (right, up) axes: the lifter, the bar with
 * the biggest plates it can carry, and what stands on the floor (rack, bench). Exact for the shapes the
 * drawing makes, so that the fixed stage has no air the set never uses.
 */
function viewExtent(camera: Camera, samples: readonly ExtentSample[], elevation = false): Box {
  const { r, u } = basis(camera);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Vec3, padX: number, padY = padX) => {
    const x = dot3(p, r), y = dot3(p, u);
    if (x - padX < x0) x0 = x - padX;
    if (x + padX > x1) x1 = x + padX;
    if (y - padY < y0) y0 = y - padY;
    if (y + padY > y1) y1 = y + padY;
  };
  // A disc whose axis is the world z axis (a plate): its outline reaches `rho` times the length of the in-plane parts of the axes.
  const discX = Math.hypot(r[0], r[1]), discY = Math.hypot(u[0], u[1]);
  const half = BAR.length / 2;
  let rack: LiftScene["rack"] = null, bench: LiftScene["bench"] = null;
  for (const { pose, scene } of samples) {
    rack = scene.rack ?? rack;
    bench = scene.bench ?? bench;
    for (const side of ["R", "L"] as const) {
      add(pose.hip[side], PAD.hip); add(pose.knee[side], PAD.knee); add(pose.ankle[side], PAD.ankle);
      add(pose.heel[side], PAD.heel); add(pose.toe[side], PAD.toe);
      add(pose.shoulder[side], PAD.shoulder); add(pose.elbow[side], PAD.elbow); add(pose.wrist[side], PAD.wrist); add(pose.hand[side], PAD.hand);
    }
    add(pose.pelvis, PAD.pelvis); add(pose.waist, PAD.waist); add(pose.chest, PAD.chest); add(pose.head, PAD.head);
    for (const sg of [-1, 1]) {
      for (const z of [0.67, 1.07]) add([pose.bar[0], pose.bar[1], sg * z], PLATE_REACH * discX, PLATE_REACH * discY);
      add([pose.bar[0], pose.bar[1], sg * half], SLEEVE_REACH * discX, SLEEVE_REACH * discY);
    }
  }
  if (rack && !elevation) {
    for (const sz of [-1, 1]) {
      for (const dx of [-0.05, 0.05]) { add([rack.x + dx, 0, sz * rack.halfWidth], 0.04); add([rack.x + dx, rackTop(rack), sz * rack.halfWidth], 0.04); }
    }
  }
  if (bench) {
    for (const sz of [-1, 1]) for (const x of [bench.headX, bench.footX]) for (const y of [bench.top - 0.1, bench.top]) add([x, y, sz * bench.halfWidth], 0.02);
    if (!elevation) for (const x of [bench.headX + 0.2, bench.footX - 0.2]) add([x, 0, 0], 0.04);
  }
  if (elevation) {
    // On the ground rule the figure stands at y = 0 and nothing hangs under it.
    if (y0 > 0) y0 = 0;
    else if (y0 < 0) y0 = 0;
  }
  if (!Number.isFinite(x0)) return [-1, 0, 1, 2];
  return [x0, y0, x1, y1];
}


/**
 * The height of the screen line the lifter stands on, as the `u` of the camera: the lowest sole point of a foot while he works at
 * the bar. The walk to a deadlift's bar is on the same ground, a little higher on the screen where it is further away.
 */
function floorLine(camera: Camera, samples: readonly ExtentSample[]): number {
  const { u } = basis(camera);
  const at = samples.some((sample) => sample.working) ? samples.filter((sample) => sample.working) : samples;
  let lowest = Infinity;
  for (const { pose } of at) for (const side of ["R", "L"] as const) for (const p of [pose.heel[side], pose.toe[side]]) lowest = Math.min(lowest, dot3([p[0], 0, p[2]], u));
  return Number.isFinite(lowest) ? lowest : 0;
}

// ---------------------------------------------------------------------------------------------------- the stage
/** The stage is as wide as the page's column: 780 units on a desk, 358 on a phone (a unit is about a CSS pixel). */
const STAGE_WIDTH: Record<StageSize, number> = { wide: 780, narrow: 358 };
/** The front view's strip on a phone, in stage units. */
export const STRIP_HEIGHT = 132;
/** The tallest the stage may be, in stage units. */
export const MAX_HEIGHT: Record<StageSize, number> = { wide: 400, narrow: 432 };
const TOP = 6;
/** Room under the floor rule for the column head on a desk, and how far under the rule its baseline stands. */
const BAND = 22, LABEL_BELOW = 15;
/** Room under the main view of a phone. */
const BOTTOM = 8;
/** Room kept at the left of the main view and between the views. */
const SIDE = 10;
const GAP = 10;
/** Room kept at the sides of the front view: 14 units each on a desk, 20 on a phone. */
const FRONT_SIDE_WIDE = 28, FRONT_SIDE_NARROW = 40;
/** On a phone: the floor rule is 15 units above the bottom of the strip, the figure's head 2 under its top. */
const STRIP_BELOW = 15, STRIP_ABOVE = 2;
/** The hairline between the views starts this far above the front figure's head. */
const DIVIDER_AIR = 8;

/** What one lift reaches in each view, in metres. */
type Reach = { kind: LiftKind; family: Family; samples: readonly ExtentSample[]; em: Box; ef: Box; floorU: number };

function reachOf(kind: LiftKind, samples: readonly ExtentSample[]): Reach {
  const family = samples[0].scene.family;
  const cams = CAMERAS[family];
  return { kind, family, samples, em: viewExtent(cams.main, samples), ef: viewExtent(cams.front, samples, true), floorU: floorLine(cams.main, samples) };
}

/**
 * Where each view goes on the stage, at what scale, for all the lifts that can be chosen on one page together: they share one
 * stage size and one scale, so that nothing on the page moves and the lifter is as big when the lift changes. Fixed for a size:
 * computed once from every pose each set can reach, with the largest plates the bar can carry.
 *
 * On a desk the two views have the same scale and stand on one floor rule; the main view takes the width the front view leaves.
 * On a phone the main view is as wide as the column and the front view is a strip under it.
 */
export function planStages(size: StageSize, lifts: ReadonlyArray<{ kind: LiftKind; samples: readonly ExtentSample[] }>): Record<LiftKind, StagePlan> {
  const reaches = lifts.map((lift) => reachOf(lift.kind, lift.samples));
  const width = STAGE_WIDTH[size];
  const wide = size === "wide";
  const emW = Math.max(...reaches.map((r) => r.em[2] - r.em[0])), efW = Math.max(...reaches.map((r) => r.ef[2] - r.ef[0]));
  const efTop = Math.max(...reaches.map((r) => r.ef[3]));
  const above = Math.max(...reaches.map((r) => r.em[3] - r.floorU)), below = Math.max(0, ...reaches.map((r) => r.floorU - r.em[1]));

  let scale: number, frontScale: number, frontW: number, floorY: number, height: number;
  if (wide) {
    scale = Math.min((width - SIDE - GAP - FRONT_SIDE_WIDE) / (emW + efW), (MAX_HEIGHT.wide - TOP - BAND) / above);
    if (below * scale > BAND) scale = Math.min(scale, (MAX_HEIGHT.wide - TOP) / (above + below));
    frontScale = scale;
    frontW = Math.round(efW * scale + FRONT_SIDE_WIDE);
    floorY = TOP + above * scale;
    height = Math.ceil(floorY + Math.max(below * scale, BAND));
  } else {
    scale = Math.min((width - 2 * SIDE) / emW, (MAX_HEIGHT.narrow - STRIP_HEIGHT - TOP - BOTTOM) / (above + below));
    frontScale = Math.min((width - FRONT_SIDE_NARROW) / efW, (STRIP_HEIGHT - STRIP_BELOW - STRIP_ABOVE) / efTop);
    frontW = width;
    floorY = TOP + above * scale;
    height = Math.ceil(floorY + below * scale + BOTTOM) + STRIP_HEIGHT;
  }
  const mainH = wide ? height : height - STRIP_HEIGHT;
  const panelMain: Box = [0, 0, wide ? width - frontW : width, mainH];
  const panelFront: Box = wide ? [width - frontW, 0, width, height] : [0, mainH, width, height];
  const floorFront = wide ? floorY : height - STRIP_BELOW;
  const cx = (panelFront[0] + panelFront[2]) / 2;
  const plans = {} as Record<LiftKind, StagePlan>;

  for (const r of reaches) {
    const cams = CAMERAS[r.family];
    const main: ViewPlan = {
      id: "main", camera: cams.main, scale,
      ox: SIDE - scale * r.em[0], oy: floorY + scale * r.floorU,
      panel: panelMain,
      extent: [SIDE, floorY - scale * (r.em[3] - r.floorU), SIDE + scale * (r.em[2] - r.em[0]), floorY + scale * (r.floorU - r.em[1])],
      label: null,
      ground: { x0: 0, x1: panelMain[2], y: floorY },
      ranks: fixedRanks(cams.main, r.samples), barDepth: meanBarDepth(cams.main, r.samples),
    };
    const half = Math.min((frontW - 12) / 2, frontScale * ((r.ef[2] - r.ef[0]) / 2 + 0.1));
    const frontRule = wide ? { x0: panelFront[0], x1: width, y: floorFront } : { x0: cx - half, x1: cx + half, y: floorFront };
    const front: ViewPlan = {
      id: "front", camera: cams.front, scale: frontScale,
      ox: cx - (frontScale * (r.ef[0] + r.ef[2])) / 2, oy: floorFront,
      panel: panelFront,
      extent: [cx - (frontScale * (r.ef[2] - r.ef[0])) / 2, floorFront - frontScale * r.ef[3], cx + (frontScale * (r.ef[2] - r.ef[0])) / 2, floorFront],
      label: { text: "Front", x: frontRule.x0 + (wide ? 14 : 0), y: floorFront + (wide ? LABEL_BELOW : 12) },
      ground: frontRule,
      ranks: fixedRanks(cams.front, r.samples), barDepth: meanBarDepth(cams.front, r.samples),
    };
    // On a desk the hairline between the views stands from just above the front figure to the floor rule.
    const divider = wide
      ? { x0: panelFront[0], y0: Math.max(TOP, floorFront - frontScale * r.ef[3] - DIVIDER_AIR), x1: panelFront[0], y1: floorFront }
      : { x0: 0, y0: mainH, x1: width, y1: mainH };
    plans[r.kind] = { size, family: r.family, width, height, views: [main, front], divider };
  }
  return plans;
}

/** The mean depth of the bar's centre along the line of sight over the poses of a set. */
function meanBarDepth(camera: Camera, samples: readonly ExtentSample[]): number {
  const { c } = basis(camera);
  let sum = 0;
  for (const { pose } of samples) sum += dot3(pose.bar, c);
  return sum / Math.max(1, samples.length);
}

/**
 * The paint order of the body, fixed for a lift and a camera. Each part is placed at its mean depth over the set: a limb on the
 * camera's side after the torso, one on the far side before it. The head goes under the torso so that the neck rises out of the
 * shoulders, unless the lifter lies down and the head is nearer the camera than the torso (a bench lifter seen from his head end), when it goes over it.
 */
function fixedRanks(camera: Camera, samples: readonly ExtentSample[]): BodyRanks {
  const { c } = basis(camera);
  const sum: Record<string, number> = {};
  const add = (key: string, p: Vec3) => { sum[key] = (sum[key] ?? 0) + dot3(p, c); };
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (const { pose } of samples) {
    for (const side of ["R", "L"] as const) {
      add(`leg-${side}`, mix(mix(pose.hip[side], pose.knee[side], 0.5), pose.ankle[side], 1 / 3));
      add(`arm-${side}`, mix(mix(pose.shoulder[side], pose.elbow[side], 0.5), mix(pose.wrist[side], pose.hand[side], 0.5), 0.5));
    }
    add("torso", mix(pose.waist, pose.chest, 0.5));
    add("head", pose.head);
  }
  const n = Math.max(1, samples.length);
  const mean = (key: string) => (sum[key] ?? 0) / n;
  const near = nearSide(camera.az);
  const torso = mean("torso");
  const lying = samples[0]?.scene.family === "bench";
  const limb = (side: "R" | "L", part: "leg" | "arm") => {
    const own = mean(`${part}-${side}`);
    return near === null ? own : side === near ? Math.max(own, torso + 0.05) : Math.min(own, torso - 0.05);
  };
  return {
    "leg-R": limb("R", "leg"), "leg-L": limb("L", "leg"), "arm-R": limb("R", "arm"), "arm-L": limb("L", "arm"),
    torso, head: lying && mean("head") > torso + 0.05 ? torso + 0.02 : torso - 0.02,
  };
}
