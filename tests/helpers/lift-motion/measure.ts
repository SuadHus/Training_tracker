// Measurements of a LiftSet, in the terms three coaches used. Pure functions over 240 Hz samples.
// `tests/lift-motion.test.ts` asserts them.

import type { LiftPose } from "../../../src/lib/lift-pose";
import type { LiftSet } from "../../../src/lib/lift-set";

export const HZ = 240;
export const DT = 1 / HZ;
export type V = [number, number, number];
export const SIDES = ["R", "L"] as const;
export type Side = (typeof SIDES)[number];
export const deg = (r: number) => (r * 180) / Math.PI;
export const sub = (a: readonly number[], b: readonly number[]): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: readonly number[], b: readonly number[]): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: readonly number[], k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: readonly number[], b: readonly number[]) => len(sub(a, b));
export const unit = (a: readonly number[]): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a: readonly number[], b: readonly number[]): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
export const both = (f: (s: Side) => number) => mean(SIDES.map(f));
export const angleAt = (a: readonly number[], b: readonly number[], c: readonly number[]) => {
  const u = sub(a, b), v = sub(c, b);
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v) || 1)))));
};
/** Angle of a->b from vertical in the x-y plane, positive toward +x. */
export const slope = (a: readonly number[], b: readonly number[]) => deg(Math.atan2(b[0] - a[0], b[1] - a[1]));

export type Sampled = { set: LiftSet; times: number[]; poses: LiftPose[]; rep(k: number): { name: string; start: number; end: number }; seg(name: string): { name: string; start: number; end: number } | undefined; idx(t: number): number };

const sampleCache = new WeakMap<LiftSet, Sampled>();
export function sample(set: LiftSet): Sampled {
  const hit = sampleCache.get(set);
  if (hit) return hit;
  const n = Math.floor(set.duration * HZ + 1e-9);
  const times: number[] = [], poses: LiftPose[] = [];
  for (let i = 0; i <= n; i++) { times.push(i * DT); poses.push(set.pose(i * DT)); }
  if (times[times.length - 1] < set.duration - 1e-9) { times.push(set.duration); poses.push(set.pose(set.duration)); }
  const s: Sampled = {
    set, times, poses,
    rep: (k) => set.timeline.find((x) => x.name === "rep " + k)!,
    seg: (name) => set.timeline.find((x) => x.name === name),
    idx: (t) => Math.max(0, Math.min(times.length - 1, Math.round(t * HZ))),
  };
  sampleCache.set(set, s);
  return s;
}

export const jointList = (p: LiftPose): Array<[string, readonly number[]]> => {
  const out: Array<[string, readonly number[]]> = [["pelvis", p.pelvis], ["waist", p.waist], ["chest", p.chest], ["head", p.head], ["bar", p.bar]];
  for (const n of ["hip", "knee", "ankle", "heel", "toe", "shoulder", "elbow", "wrist", "hand"] as const) for (const s of SIDES) out.push([n + s, p[n][s]]);
  return out;
};

/** Largest move of any joint between two samples, with where and when. */
export function maxJump(s: Sampled, from = 0, to = s.times.length - 1): { cm: number; joint: string; t: number; over2: number; over1: number } {
  let best = { cm: 0, joint: "", t: 0, over2: 0, over1: 0 };
  for (let i = Math.max(1, from); i <= to; i++) {
    const a = jointList(s.poses[i - 1]), b = jointList(s.poses[i]);
    for (let k = 0; k < a.length; k++) {
      const d = dist(a[k][1], b[k][1]) * 100;
      if (d > 2) best.over2++;
      if (d > 1) best.over1++;
      if (d > best.cm) best = { ...best, cm: d, joint: a[k][0], t: s.times[i] };
    }
  }
  return best;
}

/** Peak speed, acceleration and jerk (magnitude) of a series of points sampled at 240 Hz between sample indices. */
export function peaks(series: Array<readonly number[]>, i0: number, i1: number) {
  let v = 0, a = 0, j = 0;
  for (let i = Math.max(i0, 2); i <= Math.min(i1, series.length - 3); i++) {
    v = Math.max(v, len(sub(series[i + 1], series[i])) * HZ);
    a = Math.max(a, len(add(sub(series[i + 1], mul(series[i], 2)), series[i - 1])) * HZ * HZ);
    j = Math.max(j, len(sub(add(sub(series[i + 2], mul(series[i + 1], 3)), mul(series[i], 3)), series[i - 1])) * HZ * HZ * HZ);
  }
  return { speed: v, accel: a, jerk: j };
}

export function speedSeries(series: Array<readonly number[]>): number[] {
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const a = series[Math.max(0, i - 1)], b = series[Math.min(series.length - 1, i + 1)];
    out.push((len(sub(b, a)) * HZ) / (i === 0 || i === series.length - 1 ? 1 : 2));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ rep timing
/** Squat and bench: lead, down, pause, up, lockout of one rep, from the bar's own height. */
export function repTiming(s: Sampled, k = 1, dead = false, band = 0.01) {
  const rep = s.rep(k), i0 = s.idx(rep.start), i1 = s.idx(rep.end);
  const y = (i: number) => s.poses[i].bar[1];
  const yA = y(i0), yE = y(i1);
  let ext = y(i0);
  for (let i = i0; i <= i1; i++) ext = dead ? Math.max(ext, y(i)) : Math.min(ext, y(i));
  const near = (i: number, ref: number) => Math.abs(y(i) - ref) <= band;
  const far = (i: number, ref: number) => Math.abs(y(i) - ref) > band;
  let m0 = i0; while (m0 < i1 && near(m0, yA)) m0++;
  let e0 = m0; while (e0 < i1 && far(e0, ext)) e0++;
  let e1 = e0; while (e1 < i1 && near(e1, ext)) e1++;
  let a = e1; while (a < i1 && far(a, yE)) a++;
  const T = (n: number) => n * DT;
  return { i0, m0, e0, e1, a, i1, lead: T(m0 - i0), first: T(e0 - m0), hold: T(e1 - e0), second: T(a - e1), last: T(i1 - a), rep: T(i1 - i0), ext };
}

/** The time of the extreme bar height inside [a, b]: the middle of the run within 0.5 mm of it. */
export function extremeTime(s: Sampled, a: number, b: number, which: "min" | "max") {
  const i0 = s.idx(a), i1 = s.idx(b);
  let best = i0;
  for (let i = i0; i <= i1; i++) { const y = s.poses[i].bar[1], yb = s.poses[best].bar[1]; if (which === "min" ? y < yb : y > yb) best = i; }
  const yb = s.poses[best].bar[1];
  let lo = best, hi = best;
  while (lo > i0 && Math.abs(s.poses[lo - 1].bar[1] - yb) < 5e-4) lo--;
  while (hi < i1 && Math.abs(s.poses[hi + 1].bar[1] - yb) < 5e-4) hi++;
  return s.times[Math.round((lo + hi) / 2)];
}

export function leaveFloorTime(s: Sampled) {
  const y0 = s.poses[0].bar[1];
  for (let i = 0; i < s.poses.length; i++) if (s.poses[i].bar[1] > y0 + 0.005) return s.times[i];
  return null;
}

// ------------------------------------------------------------------------------------------------ geometry
export function distToSeg3(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = sub(b, a), ap = sub(p, a);
  const u = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1)));
  return len(sub(ap, mul(ab, u)));
}
export function distToSeg2(p: readonly number[], a: readonly number[], b: readonly number[]): [number, number] {
  const ab = [b[0] - a[0], b[1] - a[1]], ap = [p[0] - a[0], p[1] - a[1]];
  const u = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
  return [Math.hypot(p[0] - a[0] - ab[0] * u, p[1] - a[1] - ab[1] * u), u];
}
/** Closest distance between two 3D segments. */
export function segSeg(a0: readonly number[], a1: readonly number[], b0: readonly number[], b1: readonly number[]): number {
  const d1 = sub(a1, a0), d2 = sub(b1, b0), r = sub(a0, b0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / (e || 1);
  if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / (a || 1))); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / (a || 1))); }
  return len(sub(add(a0, mul(d1, s)), add(b0, mul(d2, t))));
}

/** Perpendicular distance of a point from the line through the pelvis and chest (the torso axis), in the x-y plane, positive behind the lifter. */
export function behindAxis(p: LiftPose, point: readonly number[]): number {
  const a = [p.chest[0] - p.pelvis[0], p.chest[1] - p.pelvis[1]], l = Math.hypot(a[0], a[1]);
  const b = [point[0] - p.pelvis[0], point[1] - p.pelvis[1]];
  return (a[0] * b[1] - a[1] * b[0]) / l;
}
/** Position of a point along the torso axis from the pelvis. */
export function alongAxis(p: LiftPose, point: readonly number[]): number {
  const a = [p.chest[0] - p.pelvis[0], p.chest[1] - p.pelvis[1]], l = Math.hypot(a[0], a[1]);
  return ((point[0] - p.pelvis[0]) * a[0] + (point[1] - p.pelvis[1]) * a[1]) / l;
}

export const BONES: Record<string, (p: LiftPose) => number> = {
  thighR: (p) => dist(p.hip.R, p.knee.R), thighL: (p) => dist(p.hip.L, p.knee.L),
  shankR: (p) => dist(p.knee.R, p.ankle.R), shankL: (p) => dist(p.knee.L, p.ankle.L),
  upperR: (p) => dist(p.shoulder.R, p.elbow.R), upperL: (p) => dist(p.shoulder.L, p.elbow.L),
  foreR: (p) => dist(p.elbow.R, p.wrist.R), foreL: (p) => dist(p.elbow.L, p.wrist.L),
  handR: (p) => dist(p.wrist.R, p.hand.R), handL: (p) => dist(p.wrist.L, p.hand.L),
  hipWidth: (p) => dist(p.hip.R, p.hip.L), shoulderWidth: (p) => dist(p.shoulder.R, p.shoulder.L),
  lumbar: (p) => dist(p.pelvis, p.waist), thorax: (p) => dist(p.waist, p.chest), head: (p) => dist(p.chest, p.head),
  heelToe: (p) => dist(p.heel.R, p.toe.R), heelToeL: (p) => dist(p.heel.L, p.toe.L),
};

export function boneRange(s: Sampled): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, fn] of Object.entries(BONES)) {
    let lo = Infinity, hi = -Infinity;
    for (const p of s.poses) { const v = fn(p); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    out[name] = hi - lo;
  }
  return out;
}

/** > 0 when the knee bends the anatomical way: the knee's bulge off the hip-ankle line toward where the foot points. */
export function kneeBulge(p: LiftPose, side: Side): number {
  const d = unit(sub(p.ankle[side], p.hip[side]));
  let f = sub(p.toe[side], p.heel[side]); f = [f[0], 0, f[2]]; f = unit(f);
  const fp = sub(f, mul(d, dot(f, d)));
  const k = sub(p.knee[side], p.hip[side]);
  const off = sub(k, mul(d, dot(k, d)));
  return dot(off, unit(fp));
}
/** Elbow hinge side: sign of the arm plane normal's component along the side's outward direction is not a bend test; use the angle (never > 179) and the bulge below. */
export const kneeAngle = (p: LiftPose, s: Side) => angleAt(p.hip[s], p.knee[s], p.ankle[s]);
export const elbowAngle = (p: LiftPose, s: Side) => angleAt(p.shoulder[s], p.elbow[s], p.wrist[s]);

// ------------------------------------------------------------------------------------------------ feet and steps
export type StepInfo = { side: Side; t0: number; t1: number; dur: number; length: number; dx: number; peakLift: number; peakHeelOverToe: number; peakToeOverHeel: number };
export function footEvents(s: Sampled, i0: number, i1: number) {
  const steps: StepInfo[] = [];
  const planted: Record<Side, Array<{ t0: number; t1: number; slide: number }>> = { R: [], L: [] };
  for (const side of SIDES) {
    const pl = s.poses.map((p) => p.heel[side][1] < 0.003 && p.toe[side][1] < 0.003);
    let i = i0;
    while (i <= i1) {
      const j0 = i, st = pl[i];
      while (i <= i1 && pl[i] === st) i++;
      const j1 = i - 1;
      if (st) {
        let slide = 0;
        for (let k = j0; k <= j1; k++) slide = Math.max(slide, Math.hypot(s.poses[k].ankle[side][0] - s.poses[j0].ankle[side][0], s.poses[k].ankle[side][2] - s.poses[j0].ankle[side][2]));
        planted[side].push({ t0: s.times[j0], t1: s.times[j1], slide });
      } else {
        const a = s.poses[Math.max(i0, j0 - 1)].ankle[side], b = s.poses[Math.min(i1, j1 + 1)].ankle[side];
        let peak = 0, ho = 0, th = 0;
        for (let k = j0; k <= j1; k++) {
          const p = s.poses[k];
          peak = Math.max(peak, p.ankle[side][1] - 0.08);
          ho = Math.max(ho, p.heel[side][1] - p.toe[side][1]);
          th = Math.max(th, p.toe[side][1] - p.heel[side][1]);
        }
        steps.push({ side, t0: s.times[j0], t1: s.times[j1], dur: (j1 - j0 + 1) * DT, length: Math.hypot(b[0] - a[0], b[2] - a[2]), dx: b[0] - a[0], peakLift: peak, peakHeelOverToe: ho, peakToeOverHeel: th });
      }
    }
  }
  steps.sort((a, b) => a.t0 - b.t0);
  return { steps, planted, maxSlide: Math.max(0, ...SIDES.flatMap((sd) => planted[sd].map((x) => x.slide))) };
}

/** Time during which both feet are planted between consecutive steps. */
export function doubleSupport(steps: StepInfo[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < steps.length; i++) out.push(steps[i].t0 - steps[i - 1].t1);
  return out;
}

export const stanceOf = (p: LiftPose) => ({
  heelToHeel: dist(p.heel.R, p.heel.L),
  toeOut: both((sd) => { const f = sub(p.toe[sd], p.heel[sd]); return deg(Math.atan2(Math.abs(f[2]), f[0])); }),
});

// ------------------------------------------------------------------------------------------------ collisions
/** Radii of the mannequin as the drawing makes it (lift-draw.ts), metres. */
export const RAD = { thigh: 0.092, knee: 0.062, calf: 0.064, shin: 0.05, upper: 0.054, forearm: 0.042, fist: 0.05, neck: 0.046, skull: 0.098, torso: 0.118, bar: 0.0145 };
const BAR_HALF = 0.655;
/** Distance from the bar's shaft (a segment along z at the bar's x, y) to a point. */
export const barToPoint = (p: LiftPose, q: readonly number[]) => distToSeg3(q, [p.bar[0], p.bar[1], -BAR_HALF], [p.bar[0], p.bar[1], BAR_HALF]);
/** Distance from the bar's shaft to a segment. */
export const barToSeg = (p: LiftPose, a: readonly number[], b: readonly number[]) => segSeg([p.bar[0], p.bar[1], -BAR_HALF], [p.bar[0], p.bar[1], BAR_HALF], a, b);

/** Gap between a segment (radius r1) and a tapered limb a->b (radius ra at a, rb at b): the smallest centre distance minus the radius at the nearest point. */
function gapToTapered(c0: readonly number[], c1: readonly number[], r1: number, a: readonly number[], b: readonly number[], ra: number, rb: number): number {
  let best = 9;
  for (let k = 0; k <= 10; k++) {
    const u = k / 10, q: V = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    const g = distToSeg3(q, c0, c1) - r1 - (ra + (rb - ra) * u);
    if (g < best) best = g;
  }
  return best;
}
/** Tapered radii of the legs as drawn: thigh 0.092 at the hip to 0.062 at the knee; shin 0.062 at the knee to 0.04 at the ankle. */
export const THIGH_R: [number, number] = [0.092, 0.062];
export const SHIN_R: [number, number] = [0.062, 0.04];

export type Clearances = {
  barHead: number; barNeck: number; barThigh: number; barShin: number; barKnee: number; barTorso: number;
  handTorso: number; forearmThigh: number; upperThigh: number; elbowTorso: number; footFoot: number; elbowKnee: number;
};
/** Smallest surface gaps (the tapered mannequin) over the set; negative is an overlap. */
export function clearances(s: Sampled, from = 0, to = s.poses.length - 1): Clearances {
  const out = { barHead: 9, barNeck: 9, barThigh: 9, barShin: 9, barKnee: 9, barTorso: 9, handTorso: 9, forearmThigh: 9, upperThigh: 9, elbowTorso: 9, footFoot: 9, elbowKnee: 9 };
  const min = (k: keyof Clearances, v: number) => { if (v < out[k]) out[k] = v; };
  for (let i = from; i <= to; i++) {
    const p = s.poses[i];
    const bl: V = [p.bar[0], p.bar[1], -BAR_HALF], br: V = [p.bar[0], p.bar[1], BAR_HALF];
    min("barHead", barToPoint(p, p.head) - RAD.skull - RAD.bar);
    min("barNeck", barToSeg(p, p.chest, p.head) - RAD.neck - RAD.bar);
    min("barTorso", Math.min(barToSeg(p, p.pelvis, p.waist), barToSeg(p, p.waist, p.chest)) - RAD.torso - RAD.bar);
    for (const sd of SIDES) {
      min("barThigh", gapToTapered(bl, br, RAD.bar, p.hip[sd], p.knee[sd], THIGH_R[0], THIGH_R[1]));
      min("barShin", gapToTapered(bl, br, RAD.bar, p.knee[sd], p.ankle[sd], SHIN_R[0], SHIN_R[1]));
      min("barKnee", barToPoint(p, p.knee[sd]) - RAD.knee - RAD.bar);
      min("handTorso", distToSeg3(p.hand[sd], p.pelvis, p.chest) - RAD.fist - RAD.torso);
      min("elbowTorso", distToSeg3(p.elbow[sd], p.pelvis, p.chest) - 0.044 - RAD.torso);
      for (const sd2 of SIDES) {
        min("forearmThigh", gapToTapered(p.elbow[sd], p.wrist[sd], RAD.forearm, p.hip[sd2], p.knee[sd2], THIGH_R[0], THIGH_R[1]));
        min("upperThigh", gapToTapered(p.shoulder[sd], p.elbow[sd], RAD.upper, p.hip[sd2], p.knee[sd2], THIGH_R[0], THIGH_R[1]));
      }
      min("elbowKnee", dist(p.elbow[sd], p.knee[sd]) - 0.044 - RAD.knee);
    }
    min("footFoot", segSeg(p.heel.R, p.toe.R, p.heel.L, p.toe.L) - 0.066);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the mannequin as drawn (lift-draw.ts)
// The balls the drawing builds the torso from (lift-draw.ts: ribs 55% of the way from the waist to the chest, pushed 0.01
// toward the front; shoulder balls; a chest ball and one a little further up; a waist ball; for the lower trunk the two hip
// balls and a seat ball 0.03 behind the pelvis). The signed distance to the convex hull of such balls is exact in three
// dimensions: the largest, over many directions, of the point's reach in that direction minus the hull's.
export type Ball = [readonly number[], number];
const HULL_DIRS: V[] = (() => { const o: V[] = []; const N = 300; for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963229728653; o.push([r * Math.cos(th), y, r * Math.sin(th)]); } return o; })();
export function hullSigned(pt: readonly number[], balls: Ball[]): number {
  // the support function of the hull of the balls in direction u, and the point's reach beyond it: the signed distance is the largest of these over all unit u
  const f = (u: V) => { let h = -9; for (const [c, r] of balls) h = Math.max(h, dot(c, u) + r); return dot(pt, u) - h; };
  let best = -9, bu: V = HULL_DIRS[0];
  for (const u of HULL_DIRS) { const v = f(u); if (v > best) { best = v; bu = u; } }
  // the 300 directions leave an error of a few millimetres along the long flat faces of the hull: refine the best one by a pattern search on the sphere
  let step = 0.06;
  for (let it = 0; it < 40 && step > 1e-5; it++) {
    const t1 = unit(cross(bu, Math.abs(bu[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = cross(bu, t1);
    let moved = false;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const u = unit([bu[0] + (t1[0] * a + t2[0] * b) * step, bu[1] + (t1[1] * a + t2[1] * b) * step, bu[2] + (t1[2] * a + t2[2] * b) * step]);
      const v = f(u);
      if (v > best) { best = v; bu = u; moved = true; }
    }
    if (!moved) step *= 0.5;
  }
  return best;
}
export function drawnTorso(p: LiftPose): { upper: Ball[]; lower: Ball[]; all: Ball[]; facing: V } {
  const spine = unit(sub(p.chest, p.pelvis)), sz = unit(sub(p.shoulder.R, p.shoulder.L));
  const facing = unit(cross(spine, sz));
  const ribs = add(add(mul(p.waist, 0.45), mul(p.chest, 0.55)), mul(facing, 0.01));
  const up = unit(sub(p.chest, p.waist));
  const upper: Ball[] = [[ribs, 0.118], [p.shoulder.R, 0.072], [p.shoulder.L, 0.072], [p.chest, 0.072], [add(p.chest, mul(up, 0.05)), 0.074], [p.waist, 0.08]];
  const lower: Ball[] = [[p.hip.R, 0.1], [p.hip.L, 0.1], [sub(p.pelvis, mul(facing, 0.03)), 0.104], [p.pelvis, 0.104], [p.waist, 0.08]];
  return { upper, lower, all: [...upper, ...lower], facing };
}
/** Gap between the bar's surface and the drawn upper torso (negative: the bar is inside), the worst along the bar. */
export function barToDrawnTorso(p: LiftPose): number {
  const T = drawnTorso(p);
  let m = 9;
  for (let z = -0.6; z <= 0.6001; z += 0.05) m = Math.min(m, hullSigned([p.bar[0], p.bar[1], z], T.upper) - RAD.bar);
  return m;
}

// ------------------------------------------------------------------------------------------------ limbs as drawn: tapered capsules
// The radii of lift-draw.ts (R table) and where each limb changes size (thigh: hip 0.092, 45% of the way 0.088, knee 0.062;
// shin: knee 0.062, 30% of the way 0.064, ankle 0.036; forearm 0.044 at the elbow to 0.032 at the wrist; the closed hand 0.04).
export type Cap = { name: string; a: readonly number[]; b: readonly number[]; ra: number; rb: number };
const lerp3 = (a: readonly number[], b: readonly number[], t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function drawnCaps(p: LiftPose): Cap[] {
  const out: Cap[] = [];
  for (const s of SIDES) {
    const tm = lerp3(p.hip[s], p.knee[s], 0.45), calf = lerp3(p.knee[s], p.ankle[s], 0.3);
    out.push({ name: "thigh" + s, a: p.hip[s], b: tm, ra: 0.092, rb: 0.088 }, { name: "thigh" + s, a: tm, b: p.knee[s], ra: 0.088, rb: 0.062 });
    out.push({ name: "shin" + s, a: p.knee[s], b: calf, ra: 0.062, rb: 0.064 }, { name: "shin" + s, a: calf, b: p.ankle[s], ra: 0.064, rb: 0.036 });
    out.push({ name: "foot" + s, a: p.heel[s], b: p.toe[s], ra: 0.044, rb: 0.026 });
    out.push({ name: "uarm" + s, a: p.shoulder[s], b: p.elbow[s], ra: 0.054, rb: 0.044 });
    out.push({ name: "farm" + s, a: p.elbow[s], b: p.wrist[s], ra: 0.042, rb: 0.032 });
    out.push({ name: "hand" + s, a: p.wrist[s], b: p.hand[s], ra: 0.032, rb: 0.04 });
  }
  const ribs = lerp3(p.waist, p.chest, 0.55);
  out.push({ name: "torso", a: p.pelvis, b: p.waist, ra: 0.104, rb: 0.08 }, { name: "torso", a: p.waist, b: ribs, ra: 0.08, rb: 0.118 }, { name: "torso", a: ribs, b: p.chest, ra: 0.118, rb: 0.072 });
  out.push({ name: "torso", a: p.hip.R, b: p.hip.L, ra: 0.1, rb: 0.1 }, { name: "torso", a: p.shoulder.R, b: p.shoulder.L, ra: 0.072, rb: 0.072 });
  for (const s of SIDES) out.push({ name: "torso", a: p.hip[s], b: p.shoulder[s], ra: 0.1, rb: 0.072 });
  out.push({ name: "neck", a: p.chest, b: p.head, ra: 0.046, rb: 0.046 });
  out.push({ name: "head", a: p.head, b: p.head, ra: 0.108, rb: 0.108 });
  return out;
}
/** Gap between two tapered capsules (negative: they overlap), from the closest points of their axes. */
export function capGap(x: Cap, y: Cap): number {
  const d1 = sub(x.b, x.a), d2 = sub(y.b, y.a), r = sub(x.a, y.a);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a < 1e-12 && e < 1e-12) return len(r) - x.ra - y.ra;
  if (a < 1e-12) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = dot(d1, r);
    if (e < 1e-12) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const c1 = add(x.a, mul(d1, s)), c2 = add(y.a, mul(d2, t));
  return len(sub(c1, c2)) - (x.ra + (x.rb - x.ra) * s) - (y.ra + (y.rb - y.ra) * t);
}
export const BAR_SHAFT_HALF = 1.1;
/** Gap from the bar (shaft and sleeves) to a limb. */
export function barToCap(p: LiftPose, c: Cap): number {
  return capGap({ name: "bar", a: [p.bar[0], p.bar[1], -BAR_SHAFT_HALF], b: [p.bar[0], p.bar[1], BAR_SHAFT_HALF], ra: RAD.bar, rb: RAD.bar }, c);
}
export type LimbGaps = {
  handThigh: number; forearmThigh: number; upperThigh: number; handShin: number; forearmShin: number;
  handTorso: number; forearmTorso: number; upperTorso: number; barThigh: number; barShin: number; barFarm: number; elbowTorso: number;
};
/** The smallest gap (m) of the arms to the legs and trunk, and of the bar to the legs, over the frames [from, to] (grip frames excluded for the hands and the bar's own hands). */
export function limbGaps(s: Sampled, from = 0, to = s.poses.length - 1, frames?: (i: number) => boolean): LimbGaps {
  const g: LimbGaps = { handThigh: 9, forearmThigh: 9, upperThigh: 9, handShin: 9, forearmShin: 9, handTorso: 9, forearmTorso: 9, upperTorso: 9, barThigh: 9, barShin: 9, barFarm: 9, elbowTorso: 9 };
  const min = (k: keyof LimbGaps, v: number) => { if (v < g[k]) g[k] = v; };
  for (let i = from; i <= to; i++) {
    if (frames && !frames(i)) continue;
    const p = s.poses[i], caps = drawnCaps(p);
    const by = (re: RegExp) => caps.filter((c) => re.test(c.name));
    const thighs = by(/^thigh/), shins = by(/^shin/), torso = by(/^torso/);
    for (const sd of SIDES) {
      const hand = caps.find((c) => c.name === "hand" + sd)!, farm = caps.find((c) => c.name === "farm" + sd)!, uarm = caps.find((c) => c.name === "uarm" + sd)!;
      for (const c of thighs) { min("handThigh", capGap(hand, c)); min("forearmThigh", capGap(farm, c)); min("upperThigh", capGap(uarm, c)); }
      for (const c of shins) { min("handShin", capGap(hand, c)); min("forearmShin", capGap(farm, c)); }
      for (const c of torso) { if (c.a === p.hip.R || c.a === p.hip.L || c.a === p.shoulder.R || c.a === p.shoulder.L) continue; min("handTorso", capGap(hand, c)); min("forearmTorso", capGap(farm, c)); min("upperTorso", capGap({ ...uarm, a: lerp3(uarm.a, uarm.b, 0.3), ra: 0.054 }, c)); }
      min("elbowTorso", Math.min(...torso.map((c) => capGap({ name: "elbow", a: p.elbow[sd], b: p.elbow[sd], ra: 0.044, rb: 0.044 }, c))));
      if (!p.gripping) min("barFarm", barToCap(p, farm));
    }
    for (const c of thighs) min("barThigh", barToCap(p, c));
    for (const c of shins) min("barShin", barToCap(p, c));
  }
  return g;
}

/** The arms against the drawn trunk (the lower and the upper hull of its balls are two shapes, joined at a narrow waist): the smallest gaps of the hand, the forearm and the elbow, in metres. */
export function armToDrawnTrunk(p: LiftPose): { hand: number; forearm: number; elbow: number } {
  const T = drawnTorso(p);
  const sd = (pt: readonly number[]) => Math.min(hullSigned(pt, T.upper), hullSigned(pt, T.lower));
  const out = { hand: 9, forearm: 9, elbow: 9 };
  for (const side of SIDES) {
    out.hand = Math.min(out.hand, sd(p.hand[side]) - 0.04);
    out.elbow = Math.min(out.elbow, sd(p.elbow[side]) - 0.044);
    for (const k of [0, 0.25, 0.5, 0.75, 1]) out.forearm = Math.min(out.forearm, sd(lerp3(p.elbow[side], p.wrist[side], k)) - 0.042);
  }
  return out;
}

/** The arms against the drawn upper trunk as the convex hull of its balls (what the drawing fills in: the armpits too): the smallest gap in metres of the upper arm (from half way down it) and of the forearm, to the upper hull; the upper arm is a capsule of 0.054 tapering to 0.044, the forearm 0.042 to 0.032. */
export function armsToTrunkHull(p: LiftPose): { upper: number; forearm: number } {
  const T = drawnTorso(p);
  const out = { upper: 9, forearm: 9 };
  for (const side of SIDES) {
    for (const k of [0.5, 0.625, 0.75, 0.875, 1]) out.upper = Math.min(out.upper, hullSigned(lerp3(p.shoulder[side], p.elbow[side], k), T.upper) - (0.054 - 0.01 * k));
    for (const k of [0, 0.25, 0.5, 0.75, 1]) out.forearm = Math.min(out.forearm, hullSigned(lerp3(p.elbow[side], p.wrist[side], k), T.upper) - (0.042 - 0.01 * k));
  }
  return out;
}
/** Signed distance (m) from a point to the drawn trunk taken as the union of the capsules the drawing makes it of (pelvis-waist, waist-ribs, ribs-chest, the two clavicles, the two hips): what an arm lying against the side of the chest really meets. */
export function trunkUnionSigned(pt: readonly number[], p: LiftPose): number {
  const cap = (a: readonly number[], ra: number, b: readonly number[], rb: number) => {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(pt, a), ab) / (dot(ab, ab) || 1)));
    return len(sub(pt, add(a, mul(ab, t)))) - (ra + (rb - ra) * t);
  };
  const sz = unit(sub(p.shoulder.R, p.shoulder.L)), spine = unit(sub(p.chest, p.pelvis)), facing = unit(cross(spine, sz));
  const ribs = add(add(mul(p.waist, 0.45), mul(p.chest, 0.55)), mul(facing, 0.01));
  return Math.min(cap(p.pelvis, 0.104, p.waist, 0.08), cap(p.waist, 0.08, ribs, 0.118), cap(ribs, 0.118, p.chest, 0.072), cap(p.chest, 0.072, p.shoulder.R, 0.072), cap(p.chest, 0.072, p.shoulder.L, 0.072), cap(p.pelvis, 0.104, p.hip.R, 0.1), cap(p.pelvis, 0.104, p.hip.L, 0.1));
}
/** The arms as drawn (tapered capsules: upper arm 0.054, forearm 0.042, closed hand 0.04) against the drawn trunk as the union of its capsules: the smallest gap of the upper arm (from half way down it: the shoulder ball of radius 0.072 belongs to the trunk and the upper arm of 0.054 is inside it up to 0.126 from the joint), the forearm and the hand, in metres. */
export function armsToTrunkUnion(p: LiftPose): { upper: number; forearm: number; hand: number } {
  const out = { upper: 9, forearm: 9, hand: 9 };
  for (const side of SIDES) {
    for (let k = 5; k <= 10; k++) out.upper = Math.min(out.upper, trunkUnionSigned(lerp3(p.shoulder[side], p.elbow[side], k / 10), p) - 0.054);
    for (let k = 0; k <= 10; k++) out.forearm = Math.min(out.forearm, trunkUnionSigned(lerp3(p.elbow[side], p.wrist[side], k / 10), p) - 0.042);
    for (let k = 0; k <= 10; k++) out.hand = Math.min(out.hand, trunkUnionSigned(lerp3(p.wrist[side], p.hand[side], k / 10), p) - 0.04);
  }
  return out;
}
