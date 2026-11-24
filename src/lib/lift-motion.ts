// The production motion model of the six lifts: pure TypeScript, no DOM, no clock, no randomness.
//
//   makeLiftSet(kind, { reps }) -> LiftSet     memoised per (kind, reps)
//
// One rig (pelvis, two-segment spine, head, legs and arms by two-bone solves, feet with yaw and pitch) serves all six
// lifts. One table of numbers per lift kind and one planner per family (squat, bench, deadlift) turn the table into a
// script: a list of phases, each of which moves some channels from the value the previous phase ended in to a new one.
// Because every phase starts from where the last one ended, the pose is continuous by construction. The heavy
// calibration (depth, rack height, bar path against the lifter's legs) is solved once per kind into small tables; a
// call of `pose(t)` is a binary search, a few table lookups and one pass of the rig.

import { BAR, BODY, type LiftPose, type LiftScene } from "./lift-pose";
import { makeRepAt, type LiftSet, type Segment } from "./lift-set";
import { LIFT_KINDS, MAX_DRAWN_REPS, type LiftKind } from "./lifts";
import { add, clamp, dot, lerp, lin, len, mix, mul, sine, smax, smin, smooth, sub, unit, DEG, type V } from "./lift-math";
import { BENCH, BN, DEADLIFT, DL, PAD, SQ, SQUAT, type BenchCfg, type DeadliftCfg, type MoveEnd, type SquatCfg } from "./lift-motion-tables";

// ------------------------------------------------------------------------------------------------ maths
/** A position profile (0 -> 1) from a speed shape on 0..1: the cumulative of the speed, tabulated. */
function profile(speed: (u: number) => number, n = 600): (u: number) => number {
  const c = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) c[i] = c[i - 1] + Math.max(1e-6, speed((i - 0.5) / n));
  const total = c[n];
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const x = u * n, i = Math.min(n - 1, Math.floor(x));
    return (c[i] + (c[i + 1] - c[i]) * (x - i)) / total;
  };
}
/** A speed shape from control points (u, speed), joined by half cosines so that the speed is smooth at every point. */
function shaped(points: ReadonlyArray<readonly [number, number]>): (u: number) => number {
  return (u) => {
    if (u <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (u <= points[i][0]) {
        const [a, va] = points[i - 1], [b, vb] = points[i];
        return va + (vb - va) * (0.5 - 0.5 * Math.cos((Math.PI * (u - a)) / (b - a)));
      }
    }
    return points[points.length - 1][1];
  };
}

// ------------------------------------------------------------------------------------------------ the script
type Ease = (u: number) => number;
/** How a channel travels inside one phase: u in 0..1, the value it starts from and the one it ends in. */
type Shape = (u: number, a: number, b: number) => number;
type Move = number | { to: number; ease?: Ease; shape?: Shape; set?: undefined } | { set: number };

const byEase = (ease: Ease): Shape => (u, a, b) => a + (b - a) * ease(u);
const SINE_SHAPE = byEase(sine);
/** The way a foot travels in a step: a soft start, a flat top. */
const footEase = profile(shaped([[0, 0], [0.1, 0.88], [0.5, 1], [0.9, 0.88], [1, 0]]));
/** The same for a deliberate step under a bar: gentler at both ends. */
const stepEase = profile(shaped([[0, 0], [0.25, 0.9], [0.5, 1], [0.75, 0.9], [1, 0]]));


/**
 * The position profile (0 -> 1) of a bar move of duration `T` from a speed shape in m/s: a bell given by control points,
 * with a constant-acceleration end (`a`: the bar brakes or leaves the end like a load, with a finite acceleration, which is
 * what makes a pause there read as a pause) or a soft end (`w`: the speed rises or falls as the cube of the time, so that
 * the knees, which near lockout turn a tiny change of height into a large change of angle, ease into straight). The
 * corners of the ramps are rounded by `k` m/s.
 */
function barEase(T: number, start: MoveEnd, end: MoveEnd, base: ReadonlyArray<readonly [number, number]>, k = 0.06): (u: number) => number {
  const b = shaped(base);
  return profile((u) => {
    let v = b(u);
    if (start.w) v *= smooth(u / start.w);
    if (end.w) v *= smooth((1 - u) / end.w);
    if (start.a) v = smin(v, start.a * T * u, k);
    if (end.a) v = smin(v, end.a * T * (1 - u), k);
    return v;
  });
}

/**
 * How hard rep `r` of `n` is, 0 to 1: nothing in a set shorter than `GRIND.fromReps`, then rising with the square of the rep's place, so
 * that the first reps move alike and the last one grinds. The model does not know the load: the position in the set is all it has.
 */
const grind = (r: number, n: number) => (n < GRIND.fromReps ? 0 : ((r - 1) / (n - 1)) ** 2);
const GRIND = {
  fromReps: 5,
  /** The last rep's ascent takes this much longer, its sticking region is this much slower (a share of the speed) and it waits this long (s) at the top. */
  slow: 0.2, dip: 0.3, top: 0.25,
};
/** A speed shape with its sticking region (the dip at `centre`) deepened by the grind of the rep. */
const stickier = (base: ReadonlyArray<readonly [number, number]>, centre: number, g: number): ReadonlyArray<readonly [number, number]> =>
  base.map(([u, v]) => [u, v * (1 - GRIND.dip * g * Math.exp(-(((u - centre) / 0.2) ** 2)))] as const);

/**
 * Phases on one time axis. A channel is a number that every phase moves from the value the previous phase ended in to a
 * new value (or holds). `set` channels are flags: they jump between phases and never interpolate.
 */
class Script {
  readonly index: Record<string, number> = {};
  readonly starts: number[] = [];
  readonly ends: number[] = [];
  readonly labels: string[] = [];
  readonly segs: Segment[] = [];
  private readonly from: Float64Array[] = [];
  private readonly to: Float64Array[] = [];
  private readonly shapes: Array<Array<Shape | null>> = [];
  private readonly cur: Float64Array;
  now = 0;

  constructor(readonly names: string[], init: Record<string, number>) {
    names.forEach((n, i) => (this.index[n] = i));
    this.cur = new Float64Array(names.length);
    for (const n of names) this.cur[this.index[n]] = init[n] ?? 0;
  }

  seg(name: string) { this.segs.push({ name, start: this.now, end: this.now }); }

  /** The value a channel has at the end of the script so far. */
  value(name: string) { return this.cur[this.index[name]]; }

  phase(label: string, dur: number, moves: Record<string, Move> = {}) {
    const n = this.names.length;
    const from = new Float64Array(n), to = new Float64Array(n), shapes: Array<Shape | null> = new Array(n).fill(null);
    for (let c = 0; c < n; c++) { from[c] = this.cur[c]; to[c] = this.cur[c]; }
    for (const [name, move] of Object.entries(moves)) {
      const c = this.index[name];
      if (c === undefined) throw new Error("unknown channel " + name);
      if (typeof move === "number") { to[c] = move; shapes[c] = SINE_SHAPE; }
      else if ("set" in move && move.set !== undefined) { from[c] = move.set; to[c] = move.set; }
      else if ("to" in move) { to[c] = move.to; shapes[c] = move.shape ?? (move.ease ? byEase(move.ease) : SINE_SHAPE); }
    }
    for (let c = 0; c < n; c++) this.cur[c] = to[c];
    this.starts.push(this.now); this.ends.push(this.now + dur);
    this.labels.push(label); this.from.push(from); this.to.push(to); this.shapes.push(shapes);
    this.now += dur;
    if (this.segs.length) this.segs[this.segs.length - 1].end = this.now;
  }

  get duration() { return this.now; }

  /** Phase index at t (binary search). */
  find(t: number): number {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** Fills `out` with every channel at t and returns the phase index. */
  at(t: number, out: Float64Array): number {
    t = clamp(t, 0, this.now);
    const i = this.find(t);
    const u = clamp((t - this.starts[i]) / (this.ends[i] - this.starts[i]));
    const a = this.from[i], b = this.to[i], sh = this.shapes[i];
    for (let c = 0; c < out.length; c++) {
      const s = sh[c];
      out[c] = s === null || a[c] === b[c] && !s ? a[c] : s(u, a[c], b[c]);
    }
    return i;
  }
}

// ------------------------------------------------------------------------------------------------ the rig
const SPINE = { lumbar: 0.22, thorax: 0.28 };
/** Chest (middle of the shoulder joints) to the centre of the head, and half the distance between the hip joints. */
const CHEST_TO_HEAD = BODY.neck;
const HIPH = BODY.hipHalf;

type Foot = { x: number; z: number; yaw: number; lift: number; pitch: number };

/** Ankle, heel and toe of a foot whose lowest sole point is `lift` above the floor. */
function footPoints(f: Foot): { ankle: V; heel: V; toe: V } {
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch), cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  const ay = f.lift + BODY.ankleHeight * cp + Math.max(BODY.heel * sp, -BODY.toe * sp);
  const ankle: V = [f.x, ay, f.z];
  const fwd: V = [cy * cp, sp, sy * cp], up: V = [-cy * sp, cp, -sy * sp];
  const sole = sub(ankle, mul(up, BODY.ankleHeight));
  return { ankle, heel: sub(sole, mul(fwd, BODY.heel)), toe: add(sole, mul(fwd, BODY.toe)) };
}

/** The knee of a leg whose knee is at lateral position kz: planar solve in the plane of the thigh and shank projected on x-y, bones keep their 3D length. */
function kneeAt(hip: V, ankle: V, kz: number): V {
  const dzs = kz - ankle[2], dzt = hip[2] - kz;
  const ls = Math.sqrt(Math.max(1e-6, BODY.shank * BODY.shank - dzs * dzs));
  const lt = Math.sqrt(Math.max(1e-6, BODY.thigh * BODY.thigh - dzt * dzt));
  const dx = hip[0] - ankle[0], dy = hip[1] - ankle[1], d = Math.hypot(dx, dy) || 1e-9;
  const dc = clamp(d, Math.abs(ls - lt) + 1e-4, (ls + lt) * 0.99995);
  const a = (ls * ls - lt * lt + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, ls * ls - a * a));
  const ex = dx / d, ey = dy / d;
  return [ankle[0] + ex * a + ey * h, ankle[1] + ey * a - ex * h, kz];
}

/**
 * Two-bone solve for an arm. The elbow lies on a circle around the shoulder-wrist axis; `phi` is where on it, measured from
 * the direction pointing away from the body (+z for the right arm) toward the direction `axis x outward`. Blending phi
 * (rather than a pole vector) cannot flip the elbow when a pole passes through the axis.
 */
function armAt(shoulder: V, target: V, phi: number, zs: number): { elbow: V; wrist: V } {
  const l1 = BODY.upperArm, l2 = BODY.forearm;
  const d = sub(target, shoulder), dist = len(d) || 1e-9;
  const reach = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.9996);
  const u = mul(d, 1 / dist);
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const out: V = [0, 0, zs];
  let e1 = sub(out, mul(u, dot(out, u)));
  if (len(e1) < 1e-6) e1 = [0, 1, 0];
  e1 = unit(e1);
  const e2: V = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const dir = add(mul(e1, Math.cos(phi)), mul(e2, Math.sin(phi)));
  return { elbow: add(add(shoulder, mul(u, a)), mul(dir, h)), wrist: add(shoulder, mul(u, reach)) };
}

/** The swivel angle that puts the elbow of an arm reaching for `target` on the side `pole` points to. */
function swivelOf(shoulder: V, target: V, pole: V, zs: number): number {
  const u = unit(sub(target, shoulder));
  let p = sub(pole, mul(u, dot(pole, u)));
  if (len(p) < 1e-6) p = [0, 0, zs];
  p = unit(p);
  const out: V = [0, 0, zs];
  let e1 = sub(out, mul(u, dot(out, u)));
  if (len(e1) < 1e-6) e1 = [0, 1, 0];
  e1 = unit(e1);
  const e2: V = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  return Math.atan2(dot(p, e2), dot(p, e1));
}
const wrapPi = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
/** A unit vector in the x-y plane turned from a toward b by fraction w along the shorter way round. */
function turn(a: V, b: V, w: number): V {
  const aa = Math.atan2(a[0], a[1]), bb = Math.atan2(b[0], b[1]), ang = aa + wrapPi(bb - aa) * w;
  return [Math.sin(ang), Math.cos(ang), 0];
}
/** One arm between two states: the wrist target and swivel of each, blended by w. */
function armBlend(shoulder: V, zs: number, a: { wrist: V; pole: V }, b: { wrist: V; pole: V }, w: number): { wrist: V; phi: number } {
  const pa = swivelOf(shoulder, a.wrist, a.pole, zs);
  if (w <= 0) return { wrist: a.wrist, phi: pa };
  const pb = swivelOf(shoulder, b.wrist, b.pole, zs);
  return { wrist: mix(a.wrist, b.wrist, w), phi: pa + wrapPi(pb - pa) * w };
}

/**
 * The same between two states, but each bone swings the short way. The upper arm turns from where it points in one state to
 * where it points in the other (directions mixed and normalised: they are never opposite here), pushed out of the body's
 * plane by `elbowOut` over the move, and ahead of the hand (`wElbow` runs ahead of `w`), so that the elbow is out before the
 * hand drops past the shoulder. The forearm is described the way an elbow works: by the angle `g` it makes with the upper arm
 * (the elbow's flexion, which falls steadily from one state to the other) and by the azimuth `psi` of the forearm about the
 * upper arm (blended by the shorter way round). Mixing the two forearm directions instead would spin the forearm through a
 * degenerate point when it goes from pointing up to pointing down, and blending the swivel round the shoulder-wrist axis
 * sweeps the elbow in a loop when the hand travels from a high bar to the hip.
 */
function armSwing(shoulder: V, zs: number, a: { wrist: V; pole: V }, b: { wrist: V; pole: V }, w: number, wElbow: number, elbowOut: number, psiPull = 0, elbowBack = 0): { wrist: V; phi: number } {
  const elbowOf = (s: { wrist: V; pole: V }) => armAt(shoulder, s.wrist, swivelOf(shoulder, s.wrist, s.pole, zs), zs).elbow;
  const ea = elbowOf(a), eb = elbowOf(b);
  const ua = unit(sub(ea, shoulder)), ub = unit(sub(eb, shoulder));
  const frame = (u: V): [V, V] => {
    let e1 = sub([0, 0, zs], mul(u, dot([0, 0, zs], u)));
    if (len(e1) < 1e-6) e1 = [0, 1, 0];
    e1 = unit(e1);
    return [e1, [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]]];
  };
  const polar = (u: V, f: V) => { const [e1, e2] = frame(u); return { g: Math.acos(clamp(dot(u, f), -1, 1)), psi: Math.atan2(dot(f, e2), dot(f, e1)) }; };
  const fa = polar(ua, unit(sub(a.wrist, ea))), fb = polar(ub, unit(sub(b.wrist, eb)));
  const um = unit(add(mix(ua, ub, wElbow), [-elbowBack * Math.sin(Math.PI * wElbow), 0, zs * elbowOut * Math.sin(Math.PI * wElbow)]));
  const elbow = add(shoulder, mul(um, BODY.upperArm));
  const [e1, e2] = frame(um);
  const sw = w, psi = lerp(fa.psi, fb.psi, sw) * (1 - psiPull * Math.sin(Math.PI * sw)), g = lerp(fa.g, fb.g, sw);
  const f = add(mul(um, Math.cos(g)), add(mul(e1, Math.sin(g) * Math.cos(psi)), mul(e2, Math.sin(g) * Math.sin(psi))));
  const wrist = add(elbow, mul(f, BODY.forearm));
  return { wrist, phi: swivelOf(shoulder, wrist, sub(elbow, shoulder), zs) };
}

type Side = "R" | "L";
const SIDES: readonly Side[] = ["R", "L"];
const sgn = (s: Side) => (s === "R" ? 1 : -1);

/** What the rig needs for one instant. */
type RigInput = {
  /** Pelvis centre. */
  pelvis: V;
  /** Spine angles from vertical in the x-y plane, positive toward +x: lumbar (pelvis to waist) and thorax (waist to chest). */
  a1: number; a2: number;
  /** Direction of chest -> head from vertical, and the chest-to-head distance. */
  ah: number; neck: number;
  feet: { R: Foot; L: Foot };
  /** Lateral position of each knee. */
  kz: { R: number; L: number };
  /** Wrist target, unit vector wrist -> hand centre, and elbow swivel of each arm. */
  wrist: { R: V; L: V };
  handVec: { R: V; L: V };
  phi: { R: number; L: number };
  bar: V;
  gripping: boolean;
};

function rig(r: RigInput): LiftPose {
  const P = r.pelvis;
  const d1: [number, number] = [Math.sin(r.a1), Math.cos(r.a1)], d2: [number, number] = [Math.sin(r.a2), Math.cos(r.a2)];
  const waist: V = [P[0] + SPINE.lumbar * d1[0], P[1] + SPINE.lumbar * d1[1], P[2]];
  const chest: V = [waist[0] + SPINE.thorax * d2[0], waist[1] + SPINE.thorax * d2[1], P[2]];
  const head: V = [chest[0] + r.neck * Math.sin(r.ah), chest[1] + r.neck * Math.cos(r.ah), P[2]];
  const hip = { R: [P[0], P[1], P[2] + HIPH] as V, L: [P[0], P[1], P[2] - HIPH] as V };
  const knee = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, ankle = { R: [0, 0, 0] as V, L: [0, 0, 0] as V };
  const heel = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, toe = { R: [0, 0, 0] as V, L: [0, 0, 0] as V };
  const shoulder = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, elbow = { R: [0, 0, 0] as V, L: [0, 0, 0] as V };
  const wrist = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, hand = { R: [0, 0, 0] as V, L: [0, 0, 0] as V };
  for (const side of SIDES) {
    const f = footPoints(r.feet[side]);
    ankle[side] = f.ankle; heel[side] = f.heel; toe[side] = f.toe;
    knee[side] = kneeAt(hip[side], f.ankle, r.kz[side]);
    const sh: V = [chest[0], chest[1], P[2] + sgn(side) * BODY.shoulderHalf];
    shoulder[side] = sh;
    const arm = armAt(sh, r.wrist[side], r.phi[side], sgn(side));
    elbow[side] = arm.elbow; wrist[side] = arm.wrist;
    hand[side] = add(arm.wrist, mul(r.handVec[side], BODY.hand));
  }
  return { pelvis: P, waist, chest, head, hip, knee, ankle, heel, toe, shoulder, elbow, wrist, hand, bar: r.bar, gripping: r.gripping };
}

// ------------------------------------------------------------------------------------------------ plans
type Plan = {
  script: Script;
  heroTime: number;
  scene: LiftScene;
  solve(v: Float64Array): LiftPose;
};

const FOOT_CHANNELS = ["Rx", "Rz", "Rw", "Rl", "Rp", "Lx", "Lz", "Lw", "Ll", "Lp"];
const footOf = (v: Float64Array, ix: Record<string, number>, s: Side): Foot => ({
  x: v[ix[s + "x"]], z: v[ix[s + "z"]], yaw: v[ix[s + "w"]], lift: v[ix[s + "l"]], pitch: v[ix[s + "p"]],
});

type StepOptions = {
  foot: Side; label: string; dur: number;
  to: { x?: number; z?: number; yaw?: number };
  lift: number; toeOff?: number; strike?: number;
  /** Sideways sway of the pelvis while the other foot carries the weight: amplitude, away from the swinging foot. */
  sway?: number;
  /** The foot has arrived after this share of the swing and only rolls onto its heel and toes after that. */
  arrive?: number;
  /** The travel profile of the foot (default: the walking one). */
  ease?: (u: number) => number;
};

/** One step of one foot: the foot swings from where it is to `to`, lifts, rolls off its toe and lands on its heel. */
function addStep(S: Script, o: StepOptions, extra: Record<string, Move> = {}) {
  const f = o.foot;
  const off = o.toeOff ?? 10 * DEG, strike = o.strike ?? 8 * DEG;
  const moves: Record<string, Move> = { ...extra };
  const arrive = o.arrive ?? 1, travel = o.ease ?? footEase;
  if (o.to.x !== undefined) moves[f + "x"] = { to: o.to.x, ease: (u) => travel(u / arrive) };
  if (o.to.z !== undefined) moves[f + "z"] = { to: o.to.z, ease: (u) => smooth(u / arrive) };
  if (o.to.yaw !== undefined) moves[f + "w"] = { to: o.to.yaw, ease: (u) => smooth(u / arrive) };
  moves[f + "l"] = { to: 0, shape: (u) => o.lift * Math.pow(Math.sin(Math.PI * u), 2) };
  moves[f + "p"] = {
    to: 0,
    shape: (u) => -off * (u < 0.4 ? Math.pow(Math.sin((Math.PI * u) / 0.4), 2) : 0) + strike * (u > 0.6 ? Math.pow(Math.sin((Math.PI * (u - 0.6)) / 0.4), 2) : 0),
  };
  if (o.sway !== undefined && S.index.sway !== undefined) {
    const away = f === "R" ? -1 : 1;
    moves.sway = { to: 0, shape: (u) => away * o.sway! * Math.pow(Math.sin(Math.PI * u), 2) };
  }
  S.phase(o.label, o.dur, moves);
}

// ================================================================================================ SQUAT
type SquatCal = {
  cfg: SquatCfg;
  kzTop: number; kzBot: number;
  /** The hips (x relative to the ankles, y) standing under the bar and at the bottom. */
  top: { hx: number; hy: number };
  /** The shank's and the thigh's angles from vertical standing under the bar (the thigh's positive when the hip is behind the knee) and at the bottom: the ends of their monotone turn. */
  shankTop: number; thighTop: number; thighBot: number;
  /** How much lower the hips stand when the legs keep the walking bend (`SQ.walkReach`) instead of being straight to a hair. */
  soft: number;
  bot: { hx: number; hy: number };
  /** Bar drop (m below standing) at s = i / N, and the same as a function of s: the table behind `sOfDrop`. */
  drop: Float64Array;
  sRack: number; dropRack: number; dropBottom: number;
  barStand: number;
  hookY: number;
};

const SQ_N = 4000;

function squatLegs(c: SquatCfg, kz: number) {
  const dzs = kz - c.stance, dzt = HIPH - kz;
  return { ls: Math.sqrt(BODY.shank ** 2 - dzs * dzs), lt: Math.sqrt(BODY.thigh ** 2 - dzt * dzt) };
}

type SquatPost = { hx: number; hy: number; th: number; a1: number; a2: number; ox: number; oy: number; kz: number; ah: number };

/** Offset of the bar from the pelvis for a thorax angle th. */
function barOffset(c: SquatCfg, th: number): { ox: number; oy: number; a1: number } {
  const a1 = c.lumbarK * th, a2 = th, back = c.barBack;
  return {
    a1,
    ox: SPINE.lumbar * Math.sin(a1) + SPINE.thorax * Math.sin(a2) + c.barUp * Math.sin(a2) - back * Math.cos(a2),
    oy: SPINE.lumbar * Math.cos(a1) + SPINE.thorax * Math.cos(a2) + c.barUp * Math.cos(a2) + back * Math.sin(a2),
  };
}

/** The thorax angle that puts the bar at x = bx for a pelvis at hx. */
function leanFor(c: SquatCfg, hx: number, bx: number): number {
  let th = 0.6;
  for (let i = 0; i < 6; i++) {
    const f = hx + barOffset(c, th).ox - bx;
    const e = 1e-5, df = (barOffset(c, th + e).ox - barOffset(c, th - e).ox) / (2 * e);
    th = clamp(th - f / (df || 1), 0, 1.4);
  }
  return th;
}

function prepSquat(kind: "squat-low" | "squat-high"): SquatCal {
  const c = SQUAT[kind];
  const ankleY = BODY.ankleHeight;
  const kzTop = (HIPH + c.stance) / 2 + c.kneeTop, kzBot = c.stance + c.kneeOutB;
  // bottom: shank angle and depth fix the leg, the bar over the midfoot fixes the lean
  const lb = squatLegs(c, kzBot);
  const Kb: [number, number] = [lb.ls * Math.sin(c.shankB), ankleY + lb.ls * Math.cos(c.shankB)];
  const hyB = Kb[1] + c.depth, hxB = Kb[0] - Math.sqrt(lb.lt ** 2 - c.depth ** 2);
  const bot = { hx: hxB, hy: hyB };
  // top: bar over the midfoot at the standing lean, the legs as straight as they may be
  const lt0 = squatLegs(c, kzTop);
  const hxT = SQ.midfoot - barOffset(c, c.thStand).ox;
  const yT = ankleY + Math.sqrt(((lt0.ls + lt0.lt) * SQ.standReach) ** 2 - hxT ** 2);
  const top = { hx: hxT, hy: yT };
  const soft = yT - (ankleY + Math.sqrt(((lt0.ls + lt0.lt) * SQ.walkReach) ** 2 - hxT ** 2));
  // the shank's angle standing: the forward knee of the two-link solve from the ankle to the standing hips
  const dTop = Math.hypot(top.hx, top.hy - ankleY), aTop = (lt0.ls ** 2 - lt0.lt ** 2 + dTop ** 2) / (2 * dTop), hTop = Math.sqrt(Math.max(0, lt0.ls ** 2 - aTop ** 2));
  const exT = top.hx / dTop, eyT = (top.hy - ankleY) / dTop;
  const shankTop = Math.atan2(aTop * exT + eyT * hTop, aTop * eyT - exT * hTop);
  const kneeTopX = lt0.ls * Math.sin(shankTop), kneeTopY = ankleY + lt0.ls * Math.cos(shankTop);
  const thighTop = Math.atan2(kneeTopX - top.hx, top.hy - kneeTopY), thighBot = Math.atan2(Kb[0] - bot.hx, bot.hy - Kb[1]);
  const cal: SquatCal = {
    cfg: c, kzTop, kzBot, top, shankTop, thighTop, thighBot, bot, soft, drop: new Float64Array(SQ_N + 1), sRack: 0, dropRack: 0, dropBottom: 0, barStand: 0, hookY: 0,
  };
  const feet = { R: { x: 0, z: c.stance, yaw: c.toeOut, lift: 0, pitch: 0 }, L: { x: 0, z: -c.stance, yaw: -c.toeOut, lift: 0, pitch: 0 } };
  const at = (s: number) => squatPosture(cal, s, 0, feet);
  const y0 = at(0), barStand = y0.hy + y0.oy;
  for (let i = 0; i <= SQ_N; i++) { const p = at(i / SQ_N); cal.drop[i] = barStand - (p.hy + p.oy); }
  cal.barStand = barStand;
  cal.dropBottom = cal.drop[SQ_N];
  // the rack height is a node of the table, so that the bar in the hooks is exactly the bar the lifter carries there
  let k = 0;
  for (let i = 0; i <= SQ_N; i++) if (Math.abs(cal.drop[i] - SQ.rackDrop) < Math.abs(cal.drop[k] - SQ.rackDrop)) k = i;
  cal.sRack = k / SQ_N; cal.dropRack = cal.drop[k]; cal.hookY = barStand - cal.dropRack;
  return cal;
}

/** The depth parameter s (0 standing, 1 bottom) at which the bar is `drop` metres below its standing height. */
function sOfDrop(cal: SquatCal, drop: number): number {
  const d = cal.drop;
  if (drop <= 0) return 0;
  if (drop >= d[SQ_N]) return 1;
  let lo = 0, hi = SQ_N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= drop) lo = mid; else hi = mid; }
  return (lo + (drop - d[lo]) / (d[hi] - d[lo])) / SQ_N;
}

/** The squatter at depth s with the bar over the midfoot of the feet whose mean ankle x is xbar. Pelvis x and y, lean, and where the bar sits relative to the pelvis. */
function squatPosture(cal: SquatCal, s: number, xbar: number, feet: { R: Foot; L: Foot }, tall = 1): SquatPost {
  const c = cal.cfg;
  const kz = lerp(cal.kzTop, cal.kzBot, s);
  const { ls, lt } = squatLegs(c, kz);
  // The shank leans from its standing angle to its bottom angle and never back, and the thigh turns from standing to its bottom
  // angle behind it (slowly at first: the first thing a squat does is to sit back, and the hips are above the knee for a
  // moment): the knee is where that shank puts it and the hips where that thigh puts them. (Interpolating the hips' x and y
  // directly sends the knee diving forward past its bottom position in mid-descent and back again, a loop of the knee that
  // no lifter makes.)
  const shank = lerp(cal.shankTop, c.shankB, Math.pow(s, c.shankPow)), thigh = lerp(cal.thighTop, cal.thighBot, Math.pow(s, c.thighPow));
  const kneeX = ls * Math.sin(shank), kneeY = BODY.ankleHeight + ls * Math.cos(shank);
  const hxRel = kneeX - lt * Math.sin(thigh), hyPath = kneeY + lt * Math.cos(thigh);
  const hy0 = hyPath - (1 - tall) * cal.soft * (1 - s);
  // The legs never straighten past a hair of bend, whatever the feet are doing. When a foot is far from the hips (a step
  // in or out of the rack) the lifter first sinks a little (the supporting knee bends, at most `sink`), and what is left
  // is taken up by the hips moving toward that foot, the torso leaning a little further to keep the bar over the midfoot.
  // The reach is measured to the ankle on the floor, lifted or not: a foot in the air bends its leg, and a limit that let
  // go of the moment a foot left the floor would make the hips pop up.
  let hx = xbar + hxRel;
  // standing tall, the legs may be straight to a hair; walking with the bar, they keep a clear bend (a leg that is nearly
  // straight turns the smallest change of its length into a large swing of the knee)
  const reach = (ls + lt) * lerp(SQ.walkReach, SQ.maxReach, tall);
  const dxFor = (vert: number) => Math.sqrt(Math.max(0, reach * reach - vert * vert));
  let excess = 0;
  for (const side of SIDES) { const f = feet[side]; excess = smax(excess, Math.abs(hx - f.x) - dxFor(hy0 - BODY.ankleHeight), 0.01); }
  const hy = hy0 - SQ.sink * Math.tanh(excess / 0.07);
  for (const side of SIDES) {
    const f = feet[side];
    const dxMax = dxFor(hy - BODY.ankleHeight);
    hx = f.x + smin(hx - f.x, dxMax, SQ.reachSoft);
    hx = f.x - smin(f.x - hx, dxMax, SQ.reachSoft);
  }
  const th = leanFor(c, hx, xbar + SQ.midfoot);
  const o = barOffset(c, th);
  return { hx, hy, th, a1: o.a1, a2: th, ox: o.ox, oy: o.oy, kz, ah: c.headK * th + c.headOff };
}

function planSquat(kind: "squat-low" | "squat-high", reps: number): Plan {
  const cal = prepSquat(kind), c = cal.cfg;
  const names = ["drop", "arm", "carry", "sway", "tall", ...FOOT_CHANNELS];
  const init: Record<string, number> = { drop: cal.dropRack, carry: 0, sway: 0, tall: 1, Rx: 0, Lx: 0, Rz: c.stance, Lz: -c.stance, Rw: c.toeOut, Lw: -c.toeOut };
  const S = new Script(names, init);
  const downE = barEase(c.down, SQ.descent.start, SQ.descent.end, SQ.descent.base);
  // rising to stand (unrack, the end of the release) and sinking from it: the straight-legged end is the soft one
  const standUp = barEase(0.5, { a: 1.5 }, { w: 0.5 }, [[0, 0.2], [1, 0.2]]);
  // the arms drop at an even pace with a soft start and end (a half cosine would give the hand 1.57 times its mean speed in the middle)
  const relE = profile(shaped(SQ.release.speed));
  const sitDown = barEase(0.4, { w: 0.5 }, { w: 0.5 }, [[0, 0.2], [1, 0.2]]);

  const x0 = 0;
  S.seg("under the bar");
  S.phase("setup", 0.6);
  S.seg("unrack");
  S.phase("unrack", 0.5, { drop: { to: 0, ease: standUp }, carry: { set: 1 }, tall: { to: 0, ease: sine } });
  S.seg("walkout");
  S.phase("walkout", 0.02);
  const D = SQ.walk[1];
  let wl = "walkout";
  const stepOut = (foot: Side, i: number, to: number) => addStep(S, { foot, label: wl, dur: SQ.stepDur[i], to: { x: to }, lift: SQ.stepLift, toeOff: 6 * DEG, strike: 6 * DEG, sway: SQ.sway, arrive: 0.96, ease: stepEase });
  stepOut("R", 0, x0 - SQ.walk[0]); S.phase("walkout", SQ.gap);
  stepOut("L", 1, x0 - D); S.phase("walkout", SQ.gap);
  stepOut("R", 2, x0 - D);
  S.seg("settle");
  S.phase("settle", SQ.settle, { tall: { to: 1, ease: sine } });
  const rep: Array<{ t0: number; down: number; pause: number }> = [];
  for (let r = 1; r <= reps; r++) {
    const g = grind(r, reps), up = c.up * (1 + GRIND.slow * g);
    S.seg("rep " + r);
    S.phase("brace", c.lead);
    S.phase("descent", c.down, { drop: { to: cal.dropBottom, ease: downE } });
    S.phase("bottom", c.pause);
    S.phase("ascent", up, { drop: { to: 0, ease: barEase(up, SQ.ascent.start, SQ.ascent.end, stickier(SQ.ascent.base, 0.4, g)) } });
    S.phase("lockout", c.lockout + GRIND.top * g);
    rep.push({ t0: S.starts[S.starts.length - 5], down: c.down, pause: c.pause });
  }
  S.seg("walk in");
  wl = "walk in";
  S.phase("walk in", 0.1, { tall: { to: 0, ease: sine } });
  stepOut("R", 0, x0 - D + SQ.walk[0]); S.phase("walk in", SQ.gap);
  stepOut("L", 1, x0); S.phase("walk in", SQ.gap);
  stepOut("R", 2, x0);
  S.seg("rack");
  S.phase("rack", 0.4, { drop: { to: cal.dropRack, ease: sitDown }, tall: { to: 1, ease: sine } });
  // Let go: the hands leave the bar and the arms drop over the whole phase; the lifter stays where he stood under the bar. He
  // stands up only as he steps forward out of the rack: the bar in the hooks is as far behind his back as it was when he held it
  // and the drawn ribs are wider than the bar's distance from the torso axis, so a lifter who stood up with the bar still at his
  // back would have it inside him.
  S.seg("let go");
  S.phase("let go", SQ.letGo, { carry: { set: 0 }, arm: { to: 1, ease: relE }, tall: { to: 0, ease: (u) => sine((u - 0.5) / 0.5) } });
  S.seg("step out");
  S.phase("step out", 0.02);
  // the rise from the rack height to standing is one smooth move over the steps and the pause between them
  const tRise0 = S.now + SQ.rise.from, tRise1 = tRise0 + SQ.rise.dur;
  const riseTo = (dur: number): Move => {
    const ts = S.now, te = S.now + dur;
    const at = (t: number) => cal.dropRack * (1 - standUp(clamp((t - tRise0) / (tRise1 - tRise0))));
    return { to: at(te), shape: (u) => at(ts + u * dur) };
  };
  const out = (foot: Side, to: number, dur: number) => addStep(S, { foot, label: "step out", dur, to: { x: to }, lift: 0.06, toeOff: 6 * DEG, strike: 6 * DEG, sway: 0.015, arrive: 0.96, ease: stepEase } as StepOptions, { drop: riseTo(dur) });
  out("R", x0 + SQ.outLength, 0.38); S.phase("step out", 0.05, { drop: riseTo(0.05) });
  out("L", x0 + SQ.outLength, 0.38);
  S.phase("step out", 0.08, { tall: { to: 1, ease: sine }, drop: riseTo(0.08) });

  const ix = S.index;
  const hookX = x0 + SQ.midfoot;
  const rep1 = rep[0];
  const solve = (v: Float64Array): LiftPose => {
    const feet = { R: footOf(v, ix, "R"), L: footOf(v, ix, "L") };
    const xbar = (feet.R.x + feet.L.x) / 2;
    const sway = v[ix.sway];
    const s = sOfDrop(cal, v[ix.drop]);
    const post = squatPosture(cal, s, xbar, feet, v[ix.tall]);
    const th = post.th;
    const pelvis: V = [post.hx, post.hy, sway];
    const barV: V = [xbar + SQ.midfoot, post.hy + post.oy, sway];
    const carry = v[ix.carry] > 0.5;
    const bar: V = carry ? barV : [hookX, cal.hookY, 0];
    const sT = Math.sin(th), cT = Math.cos(th);
    const arm = v[ix.arm];
    const wd = unit([-0.3 * cT, -1 + 0.3 * sT, 0]), up = mul(wd, -1);
    const kzR = post.kz + 0.5 * sway, kzL = -post.kz + 0.5 * sway;
    const wrist = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, handVec = { R: up, L: up }, phi = { R: 0, L: 0 };
    const shoulderY = post.hy + SPINE.lumbar * Math.cos(post.a1) + SPINE.thorax * Math.cos(th);
    const shoulderX = post.hx + SPINE.lumbar * Math.sin(post.a1) + SPINE.thorax * Math.sin(th);
    for (const side of SIDES) {
      const z = sgn(side);
      const hand: V = [bar[0], bar[1], sway + z * c.grip / 2];
      const wristBar = add(hand, mul(wd, BODY.hand));
      const poleBar: V = [c.pole.up * sT - c.pole.back * cT, c.pole.up * cT + c.pole.back * sT, z * c.pole.z];
      const sh: V = [shoulderX, shoulderY, sway + z * BODY.shoulderHalf];
      const wristHang: V = [sh[0] + 0.03, sh[1] - 0.54, sh[2] + z * SQ.hangOut];
      const ab = armSwing(sh, z, { wrist: wristBar, pole: poleBar }, { wrist: wristHang, pole: [-0.4, -0.2, z * SQ.hangPole] }, arm, sine(arm / (1 - SQ.release.elbowLead)), SQ.release.elbowOut, SQ.release.psiPull, SQ.release.elbowBack);
      wrist[side] = ab.wrist; phi[side] = ab.phi;
      if (arm > 0) handVec[side] = turn(up, [0.04, -1, 0], arm);
    }
    return rig({
      pelvis, a1: post.a1, a2: th, ah: post.ah, neck: CHEST_TO_HEAD, feet,
      kz: { R: kzR, L: kzL }, wrist, handVec, phi, bar, gripping: arm === 0,
    });
  };
  const heroTime = rep1.t0 + c.lead + c.down + c.pause / 2;
  return {
    script: S, heroTime, solve,
    scene: { family: "squat", rack: { x: hookX + 0.07, barX: hookX, barY: cal.hookY, halfWidth: 0.56, height: 1.85 }, bench: null, barRestY: null },
  };
}

// ================================================================================================ BENCH
type Circle = readonly [number, number, number];
/** The convex hull of circles (x, y, r), as a polygon. */
function hullPoly(circles: readonly Circle[]): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const [cx, cy, r] of circles) for (let i = 0; i < 360; i += 2) pts.push([cx + r * Math.cos(i * DEG), cy + r * Math.sin(i * DEG)]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull: Array<[number, number]> = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2], b = hull[hull.length - 1];
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0) hull.pop(); else break;
    }
    hull.push(p);
  }
  return hull;
}
/** Height of the upper outline of the convex hull of circles (x, y, r) at x. */
function hullTop(circles: readonly Circle[], x: number): number {
  const hull = hullPoly(circles);
  for (let i = 1; i < hull.length; i++) if (hull[i][0] >= x) { const a = hull[i - 1], b = hull[i]; return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0] || 1)); }
  return hull[hull.length - 1][1];
}
/**
 * The height at which a point at x is `d` from the outline of the hull (the distance to the nearest point of the outline;
 * negative when the point is inside the hull, the bar sunk into the chest): the distance grows with the height.
 */
function heightAtDistance(circles: readonly Circle[], x: number, d: number): number {
  // the closed polygon: the upper chain left to right, then the lower chain back
  const pts: Array<[number, number]> = [];
  for (const [cx, cy, r] of circles) for (let i = 0; i < 360; i += 2) pts.push([cx + r * Math.cos(i * DEG), cy + r * Math.sin(i * DEG)]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain = (sgn: number) => {
    const h: Array<[number, number]> = [];
    for (const p of pts) {
      while (h.length >= 2) {
        const a = h[h.length - 2], b = h[h.length - 1];
        if (sgn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0) h.pop(); else break;
      }
      h.push(p);
    }
    return h;
  };
  const upper = chain(1), lower = chain(-1);
  const hull = [...upper, ...lower.slice(1, -1).reverse()]; // clockwise
  const dist = (y: number) => {
    let best = Infinity, inside = true;
    for (let i = 0; i < hull.length; i++) {
      const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
      const [dd] = segDist(x, y, ax, ay, bx, by);
      if (dd < best) best = dd;
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0) inside = false; // clockwise: inside is to the right of every edge
    }
    return inside ? -best : best;
  };
  const top = hullTop(circles, x);
  let lo = top - 0.12, hi = top + 0.1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (dist(m) < d) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

type BenchCal = {
  cfg: BenchCfg;
  M: [number, number]; a1: number; a2: number; ah: number; head: V;
  ankleX: number; xL: number; yMax: (x: number) => number;
  xT: number; yT: number; yHook: number;
  /** The press at a given grind of the rep (0 to 1). */
  upE: (g: number) => (u: number) => number; downE: (u: number) => number;
};


function prepBench(kind: "bench" | "bench-close"): BenchCal {
  const cfg = BENCH[kind];
  const [sx, sy] = BN.S, [px, py] = BN.P;
  // waist: the spine bends up off the pad; |S-M| = thorax, |M-P| = lumbar
  const dx = px - sx, dy = py - sy, L = Math.hypot(dx, dy);
  const a = (SPINE.thorax ** 2 - SPINE.lumbar ** 2 + L * L) / (2 * L), h = Math.sqrt(SPINE.thorax ** 2 - a * a);
  const ex = dx / L, ey = dy / L;
  const M: [number, number] = [sx + ex * a - ey * h, sy + ey * a + ex * h];
  if (M[1] < sy + ey * a) { M[0] = sx + ex * a + ey * h; M[1] = sy + ey * a - ex * h; }
  const a2 = Math.atan2(sx - M[0], sy - M[1]), a1 = Math.atan2(M[0] - px, M[1] - py);
  const headX = sx - Math.sqrt(BN.headDist ** 2 - (BN.headY - sy) ** 2);
  const head: V = [headX, BN.headY, 0];
  const ah = Math.atan2(headX - sx, BN.headY - sy);
  // feet: the ankle sits behind the knee
  const hip: V = [px, py, HIPH];
  let lo = px - 0.2, hi = px + 0.7;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    const k = kneeAt(hip, [m, BODY.ankleHeight, BN.feetZ], BN.kneeZ);
    if (k[0] - m > BN.ankleBehindKnee) lo = m; else hi = m; // the further the ankle, the smaller knee - ankle
  }
  const ankleX = (lo + hi) / 2;
  // the bar's reach: highest the bar may be at x with the arm just short of straight
  const dz = cfg.grip - BODY.shoulderHalf;
  const yMax = (x: number) => {
    const wx = x - BODY.hand * BN.handVec[0];
    return sy + Math.sqrt(Math.max(0, BN.armMax ** 2 - (wx - sx) ** 2 - dz * dz)) + BODY.hand * BN.handVec[1];
  };
  const xL = BN.hookX + 0.18;
  // the chest as the drawing makes it (lift-draw.ts: waist, ribs pushed 0.01 toward the front, shoulder and chest balls): where the bar rests
  const dirUp = unit([sx - M[0], sy - M[1], 0]);
  const front: V = unit([sy - py, px - sx, 0]); // the way the chest faces (up, on a bench): the spine crossed with the shoulder line
  const ribs: V = [lerp(M[0], sx, 0.55) + front[0] * 0.01, lerp(M[1], sy, 0.55) + front[1] * 0.01, 0];
  const circles: Circle[] = [[M[0], M[1], 0.08], [ribs[0], ribs[1], 0.118], [sx, sy, 0.072], [sx + dirUp[0] * 0.05, sy + dirUp[1] * 0.05, 0.074]];
  const xT = sx + cfg.touch;
  const yT = heightAtDistance(circles, xT, BAR.shaftRadius - cfg.sink);
  return {
    cfg, M, a1, a2, ah, head, ankleX, xL, yMax, xT, yT, yHook: BN.hookY,
    downE: profile((u) => Math.pow(Math.sin(Math.PI * u), 0.8) * smooth(u / 0.14) * smooth((1 - u) / cfg.downTail)),
    upE: (g) => { const sh = shaped(stickier(cfg.upSpeed, 0.53, g)); return profile((u) => sh(u) * (cfg.upFloor + (1 - cfg.upFloor) * smooth((1 - u) / cfg.upTail))); },
  };
}

function planBench(kind: "bench" | "bench-close", reps: number): Plan {
  const cal = prepBench(kind), cfg = cal.cfg;
  const names = ["bx", "by", "arm"];
  const yL = cal.yMax(cal.xL) - BN.lockMargin;
  const S = new Script(names, { bx: BN.hookX, by: BN.hookY });
  // x travels a fraction of the way as a function of how far the bar is above the chest: a J curve, down and up differ
  const fracDown = (q: number) => smooth((q - cfg.xDown[0]) / cfg.xDown[1]);
  const fracUp = (q: number) => smooth((q - cfg.xUp[0]) / cfg.xUp[1]);
  S.seg("under the bar");
  S.phase("setup", 0.5);
  S.seg("lift-off");
  S.phase("lift-off", 1.1, {
    by: { to: yL, ease: (u) => smooth(u / 0.7) },
    bx: { to: cal.xL, ease: (u) => smooth((u - 0.2) / 0.8) },
  });
  S.seg("settle");
  S.phase("settle", 0.15);
  const reps0: number[] = [];
  for (let r = 1; r <= reps; r++) {
    S.seg("rep " + r);
    reps0.push(S.now);
    S.phase("descent", cfg.down, {
      by: { to: cal.yT, ease: cal.downE },
      bx: { to: cal.xT, shape: (u, a, b) => a + (b - a) * fracDown(cal.downE(u)) },
    });
    S.phase("touch", cfg.hold);
    const g = grind(r, reps), upE = cal.upE(g);
    S.phase("press", cfg.up * (1 + GRIND.slow * g), {
      by: { to: yL, ease: upE },
      bx: { to: cal.xL, shape: (u, a, b) => b + (a - b) * fracUp(1 - upE(u)) },
    });
    S.phase("lockout", cfg.lockout + GRIND.top * g);
  }
  S.seg("rack");
  S.phase("rerack", 1.1, {
    by: { to: BN.hookY, ease: (u) => smooth((u - 0.3) / 0.7) },
    bx: { to: BN.hookX, ease: (u) => smooth(u / 0.8) },
  });
  S.phase("rack", 0.4);
  S.seg("let go");
  S.phase("let go", 0.9, { arm: { to: 1, ease: smooth } });
  S.phase("rest", 0.5);

  const ix = S.index;
  const feet = {
    R: { x: cal.ankleX, z: BN.feetZ, yaw: BN.toeOut, lift: 0, pitch: 0 },
    L: { x: cal.ankleX, z: -BN.feetZ, yaw: -BN.toeOut, lift: 0, pitch: 0 },
  };
  const pelvis: V = [BN.P[0], BN.P[1], 0];
  const heroTime = reps0[0] + cfg.down + cfg.hold / 2;
  const solve = (v: Float64Array): LiftPose => {
    const x = v[ix.bx];
    const y = smin(v[ix.by], cal.yMax(x), 0.004);
    const arm = v[ix.arm];
    const wrist = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, phi = { R: 0, L: 0 }, handVec = { R: BN.handVec, L: BN.handVec };
    for (const side of SIDES) {
      const z = sgn(side);
      const hand: V = [x, y, z * cfg.grip];
      const wristBar = sub(hand, mul(BN.handVec, BODY.hand));
      const restHand: V = [BN.restHand[0], BN.restHand[1], z * BN.restHand[2]];
      const restVec: V = BN.restVec;
      const wristRest = sub(restHand, mul(restVec, BODY.hand));
      const sh: V = [BN.S[0], BN.S[1], z * BODY.shoulderHalf];
      const pb = swivelOf(sh, wristRest, [BN.restPole[0], BN.restPole[1], z * BN.restPole[2]], z);
      const phiBar = z * (cfg.swivel + cfg.swivelUp * smooth((y - cal.yT) / ((yL - cal.yT) * cfg.swivelSpan))); // mirrored: the swivel is measured from the outward side, with a handedness that flips between the arms
      const ab = { wrist: mix(wristBar, wristRest, arm), phi: phiBar + wrapPi(pb - phiBar) * arm };
      wrist[side] = ab.wrist; phi[side] = ab.phi;
      if (arm > 0) handVec[side] = turn(BN.handVec, restVec, arm);
    }
    return rig({
      pelvis, a1: cal.a1, a2: cal.a2, ah: cal.ah, neck: BN.headDist, feet,
      kz: { R: BN.kneeZ, L: -BN.kneeZ }, wrist, handVec, phi, bar: [x, y, 0], gripping: arm === 0,
    });
  };
  return {
    script: S, heroTime, solve,
    scene: {
      family: "bench",
      rack: { x: BN.hookX - 0.07, barX: BN.hookX, barY: BN.hookY, halfWidth: BN.rackHalf, height: 1.45 },
      bench: { headX: -0.42, footX: 0.8, top: PAD, halfWidth: 0.15 },
      barRestY: null,
    },
  };
}

// ================================================================================================ DEADLIFT
type DlPath = { hx: Float64Array; hy: Float64Array; a: Float64Array; barY: Float64Array };

type DlCal = {
  cfg: DeadliftCfg;
  xf: number;
  ankle: { R: V; L: V };
  barLockY: number;
  up: DlPath; down: DlPath;
  /** The start pose before (sigma 0) and after (sigma 1) the slack is taken out: pelvis x, y, back angle. */
  slack0: [number, number, number];
  /** The pull at a given grind of the rep (0 to 1). */
  pullE: (g: number) => (u: number) => number; lowerE: (u: number) => number;
};

/**
 * Where the knee of a deadlifter sits sideways: out over the toes (`out` beyond the ankle) while the leg is bent, and as far
 * out as the leg can reach once it is nearly straight (then the knee comes in toward the hip-ankle line).
 */
function dlKneeZ(hip: V, ankle: V, out: number): number {
  const zs = ankle[2] >= 0 ? 1 : -1;
  const full = ankle[2] + zs * out;
  const dxy = Math.hypot(hip[0] - ankle[0], hip[1] - ankle[1]);
  const reachAt = (kz: number) => Math.sqrt(Math.max(0, BODY.shank ** 2 - (kz - ankle[2]) ** 2)) + Math.sqrt(Math.max(0, BODY.thigh ** 2 - (hip[2] - kz) ** 2));
  const need = dxy / 0.9997;
  let feasible = full;
  if (reachAt(full) < need) {
    let lo = (hip[2] + ankle[2]) / 2, hi = full;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (reachAt(m) >= need) lo = m; else hi = m; }
    feasible = lo;
  } else {
    // still bent: how far from the limit, as a distance the knee could move out
    let lo = full, hi = full + 0.4 * zs;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (reachAt(m) >= need) lo = m; else hi = m; }
    feasible = lo;
  }
  // a smooth minimum, so that the knee eases in toward the line instead of snapping when the leg nears the limit
  return zs * smin(zs * full, zs * feasible, 0.06);
}
const armDrop = (dxs: number, dz: number) => BODY.hand + Math.sqrt(Math.max(0, DL.arm ** 2 - dxs * dxs - dz * dz));
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const abx = bx - ax, aby = by - ay, u = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1));
  return [Math.hypot(px - ax - abx * u, py - ay - aby * u), u];
}

function prepDeadlift(kind: "deadlift-conventional" | "deadlift-sumo"): DlCal {
  const cfg = DEADLIFT[kind];
  const xf = -cfg.barAhead;
  const ankleR = footPoints({ x: xf, z: cfg.stance, yaw: cfg.toeOut, lift: 0, pitch: 0 }).ankle;
  const ankleL = footPoints({ x: xf, z: -cfg.stance, yaw: -cfg.toeOut, lift: 0, pitch: 0 }).ankle;
  const dzArm = cfg.grip - BODY.shoulderHalf;
  // lockout: the legs as straight as allowed, the torso at alphaLock, the arms hanging straight from the shoulders
  const SH = SPINE.lumbar + SPINE.thorax;
  const hxL = cfg.dxsLock - SH * Math.cos(cfg.alphaLock);
  const dzLeg = cfg.stance - HIPH;
  const hyL = BODY.ankleHeight + Math.sqrt(Math.max(0, DL.reach ** 2 - (hxL - xf) ** 2 - dzLeg ** 2));
  const barLockY = hyL + SH * Math.sin(cfg.alphaLock) - armDrop(cfg.dxsLock, dzArm);
  const kneeLock = 174 * DEG;
  const extension = (p: number, up: boolean) => (up ? 1 - Math.pow(1 - p, cfg.upExp) : 1 - Math.pow(1 - Math.min(1, p / cfg.downHold), cfg.downExp));
  const dxsOf = (p: number) => lerp(cfg.dxs0, cfg.dxsLock, smooth((p - 0.2) / 0.8));
  /** The pelvis for a bar at barY, shoulders at x = dxs and the knees at the interior angle `knee`: the torso angle is what makes the hips that far from the ankles. */
  const solve = (barY: number, knee: number, dxs: number): [number, number, number] => {
    const Sx = dxs, Sy = barY + armDrop(dxs, dzArm);
    const want = 2 * BODY.thigh * Math.sin(knee / 2);
    const hipAt = (al: number): V => [Sx - SH * Math.cos(al), Sy - SH * Math.sin(al), HIPH];
    let lo = 0.15, hi = Math.PI / 2; // the hips come nearer the ankles as the torso rises
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (len(sub(hipAt(m), ankleR)) > want) lo = m; else hi = m; }
    const al = (lo + hi) / 2, hip = hipAt(al);
    return [hip[0], hip[1], al];
  };
  const path = (up: boolean): DlPath => {
    const n = DL.pull;
    const o: DlPath = { hx: new Float64Array(n + 1), hy: new Float64Array(n + 1), a: new Float64Array(n + 1), barY: new Float64Array(n + 1) };
    for (let i = 0; i <= n; i++) {
      const p = 1 - (1 - i / n) ** 2, barY = lerp(DL.barY, barLockY, p); // nodes crowd toward lockout, where the hips' position goes as the square root of the bar's height below it
      const [hx, hy, al] = solve(barY, lerp(cfg.kneeStart, kneeLock, extension(p, up)), dxsOf(p));
      o.hx[i] = hx; o.hy[i] = hy; o.a[i] = al; o.barY[i] = barY;
    }
    return o;
  };
  const slack0 = solve(DL.barY, cfg.kneeStart + cfg.slackKnee, cfg.dxs0 + cfg.slackDxs);
  return {
    cfg, xf, ankle: { R: ankleR, L: ankleL }, barLockY, up: path(true), down: path(false), slack0,
    pullE: (g) => profile(shaped(stickier([[0, 0], [0.12, cfg.pullStart], [0.35, 0.62], [0.62, 0.45], [0.82, 0.58], [1, 0]], 0.62, g))), lowerE: (() => { const sh = shaped([[0, 0.3], [0.22, 0.62], [0.5, cfg.lowerPeak], [0.8, 0.55], [1, 0]]); return profile((u) => sh(u) * smooth(u / 0.3)); })(),
  };
}

/**
 * A hand that hangs free keeps clear of the thighs: where it would come closer than `dMin` to the axis of a thigh (a mitt and a
 * thigh as drawn, with a margin) it is pushed straight away from it, and the arm keeps its length from the shoulder. The push is
 * a smooth function of the distance, so it is felt a little before the limit and never as a jump.
 */
function clearOfThighs(point: V, thighs: ReadonlyArray<readonly [V, V]>, dMin: number, shoulder: V, armLen: number): V {
  let p = point;
  for (const [a, b] of thighs) {
    const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1));
    const q = add(a, mul(ab, t)), d = sub(p, q), dl = len(d) || 1e-6;
    const k = 0.012, short = (dMin - dl) / k;
    const push = short > 30 ? dMin - dl : k * Math.log1p(Math.exp(short));
    if (push > 1e-6) p = add(q, mul(d, (dl + push) / dl));
  }
  return add(shoulder, mul(unit(sub(p, shoulder)), armLen));
}

/** A path table at the bar's progress p (0 floor, 1 lockout): the nodes are at p = 1 - (1 - i / n)^2, so that the square-root approach to lockout is linear in the table's own coordinate. */
function tableAt(t: Float64Array, p: number): number {
  const x = (1 - Math.sqrt(1 - clamp(p))) * (t.length - 1), i = Math.min(t.length - 2, Math.floor(x));
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}

function planDeadlift(kind: "deadlift-conventional" | "deadlift-sumo", reps: number): Plan {
  const cal = prepDeadlift(kind), cfg = cal.cfg;
  const names = ["p", "dn", "h", "eps", "sig", "sway", "tall", ...FOOT_CHANNELS];
  const WS = DL.walkStance;
  const D = cfg.approach;
  const x0 = cal.xf - D;
  const S = new Script(names, { Rx: x0, Lx: x0, Rz: WS, Lz: -WS, Rw: 0, Lw: 0, tall: 1 });
  const T = cfg.tempo;
  const standUp = profile(shaped([[0, 0], [0.12, 1], [0.88, 1], [1, 0]]));
  S.seg("approach");
  S.phase("stand", 0.2, { tall: { to: 0, ease: sine } });
  const walk = (foot: Side, label: string, to: { x: number; z?: number; yaw?: number }, dur: number, lift: number) =>
    addStep(S, { foot, label, dur, to, lift, toeOff: 13 * DEG, strike: 10 * DEG, sway: 0.012, arrive: 0.93, ease: stepEase });
  const fin = { z: cfg.stance, yaw: cfg.toeOut };
  const finL = { z: -cfg.stance, yaw: -cfg.toeOut };
  // Alternating steps of even cadence; the left foot, which steps twice, has the longest (D / 2). A sumo stance is reached a
  // little more on each step instead of all at once (a wide, turned-out step in one stride would swing the toe at 2.5 m/s).
  const ST = DL.stepDur;
  const w = cfg.wide ? DL.widen : null;
  const xs = [x0 + 0.33, x0 + D * 0.52, x0 + D * 0.79, x0 + D, x0 + D];
  const zy: Array<{ z?: number; yaw?: number }> = [
    {}, w ? { z: -w.l2z, yaw: -cfg.toeOut * w.l2yaw } : {},
    w ? { z: w.r3z, yaw: cfg.toeOut * w.r3yaw } : {}, finL, fin,
  ];
  const feet: Side[] = ["R", "L", "R", "L", "R"];
  const labels = ["walk up", "walk up", "walk up", cfg.wide ? "step wide" : "walk up", cfg.wide ? "step wide" : "set feet"];
  const lifts = [0.075, 0.085, 0.085, cfg.wide ? 0.065 : 0.07, cfg.wide ? 0.055 : 0.05];
  for (let i = 0; i < 5; i++) {
    walk(feet[i], labels[i], { x: xs[i], ...zy[i] }, ST * (cfg.wide && i >= 3 ? DL.wideScale : 1), lifts[i]);
    if (i < 4) S.phase(labels[i], DL.stepGap);
  }
  S.phase("settle", cfg.wide ? 0.8 : 0.2);
  S.seg("grip");
  S.phase("hinge", DL.hinge, { h: { to: 1, ease: lin }, eps: { to: 1, ease: (u) => sine((u - 0.1) / 0.9) } });
  S.phase("slack", 0.25, { sig: { to: 1, ease: sine } });
  const rep0: number[] = [];
  for (let r = 1; r <= reps; r++) {
    S.seg("rep " + r);
    rep0.push(S.now);
    const g = grind(r, reps), pull = T.pull * (1 + GRIND.slow * g), pullE = cal.pullE(g);
    S.phase("pull", T.lead + pull, { p: { to: 1, ease: (u) => pullE(clamp((u * (T.lead + pull) - T.lead) / pull)) } });
    S.phase("hold", T.hold + GRIND.top * g, { dn: { to: 1, ease: lin } });
    S.phase("lowering", T.lower, { p: { to: 0, ease: (u) => cal.lowerE(u) } });
    S.phase("on the floor", T.floor, { dn: { to: 0, ease: lin } });
  }
  S.seg("let go");
  // The hands let go first; the torso rises only after they are off the bar, at an even pace (a trapezoid of speed), and the legs finish straight.
  S.phase("let go", DL.letGo, { h: { to: 0, ease: standUp }, eps: { to: 0, ease: (u) => smooth(u / 0.3) } });
  S.phase("stand", DL.standTall, { tall: { to: 1, ease: sine } });

  const ix = S.index;
  // the most telling still: the bar at the knees, the back angle still held, the knees still bent (a bar just off the floor is a smaller picture)
  let heroTime = rep0[0] + T.lead + T.pull * 0.3;
  {
    const probe = new Float64Array(S.names.length);
    const goal = (DL.heroRise / (cal.barLockY - DL.barY));
    for (let t = rep0[0]; t < rep0[0] + T.lead + T.pull; t += 0.002) { S.at(t, probe); if (probe[S.index.p] >= goal) { heroTime = t; break; } }
  }
  const hv = unit([0.25, -1, 0]);
  const solve = (v: Float64Array): LiftPose => {
    const feet = { R: footOf(v, ix, "R"), L: footOf(v, ix, "L") };
    const sway = v[ix.sway], h = v[ix.h], eps = v[ix.eps], sig = v[ix.sig], p = v[ix.p], dn = v[ix.dn];
    const xmid = (feet.R.x + feet.L.x) / 2;
    const stagger = feet.R.x - feet.L.x;
    // standing (walking): upright; the pelvis is as high as the legs allow (straight to a hair when standing tall, with a clear bend
    // while walking), and lower when the feet are apart
    let sy = 10;
    const reachNow = lerp(DL.walkReach, DL.reach, v[ix.tall]);
    for (const side of SIDES) {
      const f = footPoints(feet[side]);
      const dx = xmid - 0.03 - f.ankle[0], dz = sway + sgn(side) * HIPH - f.ankle[2];
      sy = smin(sy, f.ankle[1] + Math.sqrt(Math.max(0, reachNow ** 2 - dx * dx - dz * dz)), DL.heightSoft);
    }
    sy += DL.heightSoft / 4; // (a soft minimum of two equal heights is k / 4 below them: standing on both feet the pelvis is where the legs put it)
    const stand = { hx: xmid - 0.03, hy: sy, a: 0.5 * DEG };
    // the pull at (p, sigma) from the tables; the slack blends the two start poses
    const hxU = tableAt(cal.up.hx, p), hyU = tableAt(cal.up.hy, p), aU = tableAt(cal.up.a, p);
    const hxD = tableAt(cal.down.hx, p), hyD = tableAt(cal.down.hy, p), aD = tableAt(cal.down.a, p);
    let bx = lerp(hxU, hxD, dn), by = lerp(hyU, hyD, dn), ba = lerp(aU, aD, dn);
    const sl = 1 - sig;
    bx += (cal.slack0[0] - cal.up.hx[0]) * sl * (1 - clamp(p / 0.15));
    by += (cal.slack0[1] - cal.up.hy[0]) * sl * (1 - clamp(p / 0.15));
    ba += (cal.slack0[2] - cal.up.a[0]) * sl * (1 - clamp(p / 0.15));
    const wx = sine(h * 1.5), wy = sine(h), wa = sine(h * 1.2);
    const hx = lerp(stand.hx, bx, wx), hy = lerp(stand.hy, by, wy), alpha = lerp(Math.PI / 2 - stand.a, ba, wa);
    const a = Math.PI / 2 - alpha;
    const barY = lerp(DL.barY, cal.barLockY, p);
    const pelvis: V = [hx, hy, sway];
    const sx = hx + SH_LEN * Math.cos(alpha), sY = hy + SH_LEN * Math.sin(alpha);
    const swing = DL.swing * stagger;
    const widen = smooth(clamp((Math.abs(feet.R.z) + Math.abs(feet.L.z) - 0.2 * 1.1) / 0.5)) * (1 - sine(h * 2)) * (1 - v[ix.tall]);
    const hipAt = (side: Side): V => [hx, hy, sway + sgn(side) * HIPH];
    const kneeOf = (side: Side): V => { const ankle = footPoints(feet[side]).ankle, hp = hipAt(side); return kneeAt(hp, ankle, dlKneeZ(hp, ankle, cfg.kneeOut)); };
    const thighs: Array<readonly [V, V]> = [[hipAt("R"), kneeOf("R")], [hipAt("L"), kneeOf("L")]];
    const wrist = { R: [0, 0, 0] as V, L: [0, 0, 0] as V }, phi = { R: 0, L: 0 }, handVec = { R: hv, L: hv };
    for (const side of SIDES) {
      const z = sgn(side);
      const sw = z > 0 ? -swing : swing, ang = clamp(sw / DL.arm, -0.5, 0.5) + cfg.handFwd;
      const dzFree = cfg.handOut + cfg.handOutWide * widen, armL = Math.sqrt(DL.armFree ** 2 - dzFree ** 2);
      // the free hand (centre of the fist, a hand's length from the wrist) is what must stay clear of the thighs
      const toHand = mul(hv, BODY.hand);
      const handFree = clearOfThighs(add([sx + Math.sin(ang) * armL, sY - Math.cos(ang) * armL, sway + z * (BODY.shoulderHalf + dzFree)], toHand), thighs, DL.armClear, add([sx, sY, sway + z * BODY.shoulderHalf], toHand), DL.armFree);
      const free = sub(handFree, toHand);
      const onBar: V = [0, barY + BODY.hand, z * cfg.grip];
      const shd: V = [sx, sY, sway + z * BODY.shoulderHalf];
      const epsE = eps;
      const ab = armBlend(shd, z, { wrist: free, pole: [-0.2, -0.3, z * 0.8] }, { wrist: onBar, pole: [-0.2, -0.3, z * 0.8] }, epsE);
      // on its way between the side of the body and the bar the hand passes outside the knee
      ab.wrist = [ab.wrist[0], ab.wrist[1], ab.wrist[2] + z * cfg.handSwing * Math.sin(Math.PI * epsE)];
      wrist[side] = ab.wrist; phi[side] = ab.phi;
      handVec[side] = turn(hv, [0, -1, 0], eps);
    }
    return rig({
      pelvis, a1: a, a2: a, ah: cfg.headK * a, neck: CHEST_TO_HEAD, feet,
      kz: { R: dlKneeZ([pelvis[0], pelvis[1], pelvis[2] + HIPH], footPoints(feet.R).ankle, cfg.kneeOut), L: dlKneeZ([pelvis[0], pelvis[1], pelvis[2] - HIPH], footPoints(feet.L).ankle, cfg.kneeOut) },
      wrist, handVec, phi, bar: [0, barY, 0], gripping: eps >= 1,
    });
  };
  return { script: S, heroTime, solve, scene: { family: "deadlift", rack: null, bench: null, barRestY: DL.barY } };
}
const SH_LEN = SPINE.lumbar + SPINE.thorax;

// ================================================================================================ the set
const cache = new Map<string, LiftSet>();

function assemble(kind: LiftKind, reps: number, plan: Plan): LiftSet {
  const S = plan.script;
  const v = new Float64Array(S.names.length);
  const timeline = S.segs.map((s) => ({ ...s }));
  return {
    kind, reps, duration: S.duration, heroTime: plan.heroTime, timeline, scene: plan.scene,
    pose(t: number) { S.at(t, v); return plan.solve(v); },
    phase(t: number) { return S.labels[S.find(clamp(t, 0, S.duration))]; },
    repAt: makeRepAt(timeline),
  };
}

/** Builds a set from the tables as they are now, without the memo (the tests change a table and build again). */
export function buildLiftSet(kind: LiftKind, reps: number): LiftSet {
  let plan: Plan;
  if (kind === "squat-low" || kind === "squat-high") plan = planSquat(kind, reps);
  else if (kind === "bench" || kind === "bench-close") plan = planBench(kind, reps);
  else if (kind === "deadlift-conventional" || kind === "deadlift-sumo") plan = planDeadlift(kind, reps);
  else throw new Error(`unknown lift ${String(kind)}`);
  return assemble(kind, reps, plan);
}

/** The reps a set can have: one to `MAX_DRAWN_REPS`; anything that is not a number counts as one, and infinity as the most. */
const clampReps = (reps: number) => Math.max(1, Math.min(MAX_DRAWN_REPS, reps === Infinity ? MAX_DRAWN_REPS : Math.round(Number.isFinite(reps) ? reps : 1)));

/** The set of a lift for a number of reps: one build per (kind, reps), shared. Throws on a kind that is none of the six. */
export function makeLiftSet(kind: LiftKind, options: { reps: number }): LiftSet {
  if (!LIFT_KINDS.includes(kind)) throw new Error(`unknown lift ${String(kind)}`);
  const reps = clampReps(Number(options.reps));
  const key = kind + "/" + reps;
  let set = cache.get(key);
  if (!set) {
    set = buildLiftSet(kind, reps);
    cache.set(key, set);
  }
  return set;
}

/** The numbers behind the lifts, exported so that the tests can break them on purpose. */
export const LIFT_TABLES = { squat: SQUAT, squatShared: SQ, bench: BENCH, benchShared: BN, deadlift: DEADLIFT, deadliftShared: DL };
