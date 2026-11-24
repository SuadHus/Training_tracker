// The motion model of the six lifts: the reference targets for each lift as assertions, the invariants of a lifter, and a table of
// deliberate mutations, each of which must make the suite fail.
//
//   tsx --test tests/lift-motion.test.ts                       the targets and invariants (seconds)
//   LIFT_MUTATIONS=1 tsx --test tests/lift-motion.test.ts      and the mutation table (minutes: every mutation reruns the suite)
//   MUTATION_REPORT=1 with it                                  prints, for each mutation, how many checks it breaks and the first three
//
// What "lean" or "double support" means is in `helpers/lift-motion/measure.ts`; the targets are in `squat.ts`, `bench.ts`,
// `deadlift.ts`, `general.ts` and `pairs.ts` beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiftSet, LIFT_TABLES, makeLiftSet } from "../src/lib/lift-motion";
import type { LiftSet } from "../src/lib/lift-set";
import { LIFT_KINDS, liftFamily, type LiftKind } from "../src/lib/lifts";
import type { LiftPose } from "../src/lib/lift-pose";
import * as M from "./helpers/lift-motion/measure";
import { passes, show, source, type Check } from "./helpers/lift-motion/check";
import { benchSuite } from "./helpers/lift-motion/bench";
import { deadliftSuite } from "./helpers/lift-motion/deadlift";
import { generalChecks, heavyContinuity, jointSmoothness } from "./helpers/lift-motion/general";
import { pairChecks } from "./helpers/lift-motion/pairs";
import { squatSuite } from "./helpers/lift-motion/squat";

const KINDS = LIFT_KINDS;

function familyChecks(kind: LiftKind): Check[] {
  if (kind === "squat-low" || kind === "squat-high") return squatSuite(kind);
  if (kind === "bench" || kind === "bench-close") return benchSuite(kind);
  return deadliftSuite(kind);
}
const suite = (kind: LiftKind): Check[] => [...familyChecks(kind), ...generalChecks(kind), ...jointSmoothness(kind)];

// ------------------------------------------------------------------------------------------------ the reference targets
for (const kind of KINDS) {
  for (const check of suite(kind)) {
    test(check.id, () => assert.ok(passes(check), show(check)));
  }
}
for (const check of pairChecks()) test(check.id, () => assert.ok(passes(check), show(check)));

// ------------------------------------------------------------------------------------------------ continuity at every length
for (const kind of KINDS) {
  for (const reps of [1, 2, 5, 30]) {
    test(`${kind}: ${reps} reps: no joint moves more than 1 cm between two samples 1/240 s apart`, () => {
      const check = heavyContinuity(kind, reps);
      assert.ok(passes(check), show(check));
    });
  }
}

// ------------------------------------------------------------------------------------------------ the shape of a set
test("reps are clamped to 1..30, non-numbers count as 1, and each (kind, reps) is built once", () => {
  for (const kind of KINDS) {
    assert.equal(makeLiftSet(kind, { reps: 0 }).reps, 1);
    assert.equal(makeLiftSet(kind, { reps: -4 }).reps, 1);
    assert.equal(makeLiftSet(kind, { reps: 31 }).reps, 30);
    assert.equal(makeLiftSet(kind, { reps: 2.4 }).reps, 2);
    assert.equal(makeLiftSet(kind, { reps: Number.NaN }).reps, 1);
    assert.equal(makeLiftSet(kind, { reps: 3 }), makeLiftSet(kind, { reps: 3 }), "memoised");
    assert.notEqual(makeLiftSet(kind, { reps: 3 }), makeLiftSet(kind, { reps: 4 }));
    assert.equal(makeLiftSet(kind, { reps: 99 }), makeLiftSet(kind, { reps: 30 }));
  }
});

test("the timeline has one segment per rep, named rep 1 .. rep n, contiguous with the segments around them, from 0 to the duration", () => {
  for (const kind of KINDS) for (const reps of [1, 2, 5, 30]) {
    const set = makeLiftSet(kind, { reps });
    const tl = set.timeline;
    assert.equal(tl[0].start, 0);
    assert.ok(Math.abs(tl[tl.length - 1].end - set.duration) < 1e-9);
    for (let i = 1; i < tl.length; i++) assert.ok(Math.abs(tl[i].start - tl[i - 1].end) < 1e-9, `${kind} ${tl[i].name}`);
    const names = tl.filter((s) => /^rep /.test(s.name)).map((s) => s.name);
    assert.deepEqual(names, Array.from({ length: reps }, (_, i) => `rep ${i + 1}`));
    const first = tl.findIndex((s) => s.name === "rep 1"), last = tl.findIndex((s) => s.name === `rep ${reps}`);
    assert.equal(last - first, reps - 1, "the reps follow each other directly");
    assert.ok(first > 0 && last < tl.length - 1, "something comes before the first rep and after the last");
  }
});

test("the set starts at the rack (or at the bar) and ends the way the reference asks", () => {
  const names = (k: LiftKind) => makeLiftSet(k, { reps: 2 }).timeline.map((s) => s.name).filter((n) => !/^rep /.test(n));
  assert.deepEqual(names("squat-low"), ["under the bar", "unrack", "walkout", "settle", "walk in", "rack", "let go", "step out"]);
  assert.deepEqual(names("squat-high"), names("squat-low"));
  assert.deepEqual(names("bench"), ["under the bar", "lift-off", "settle", "rack", "let go"]);
  assert.deepEqual(names("bench-close"), names("bench"));
  assert.deepEqual(names("deadlift-conventional"), ["approach", "grip", "let go"]);
  assert.deepEqual(names("deadlift-sumo"), names("deadlift-conventional"));
});

test("phase(t) answers with a quiet word for every instant, also outside the set", () => {
  for (const kind of KINDS) {
    const set = makeLiftSet(kind, { reps: 3 });
    const seen = new Set<string>();
    for (let i = -5; i <= 2005; i++) {
      const word = set.phase((set.duration * i) / 2000);
      assert.match(word, /^([a-z-]+( [a-z-]+)?|on the floor)$/);
      seen.add(word);
    }
    for (const needed of liftFamily(kind) === "squat" ? ["walkout", "descent", "bottom", "ascent", "lockout"] : liftFamily(kind) === "bench" ? ["descent", "touch", "press", "lockout"] : ["pull", "hold", "lowering", "on the floor"]) {
      assert.ok(seen.has(needed), `${kind} says "${needed}"`);
    }
  }
});

test("repAt agrees with the timeline, at every instant", () => {
  const set = makeLiftSet("squat-low", { reps: 3 });
  const r2 = set.timeline.find((s) => s.name === "rep 2")!;
  assert.deepEqual(set.repAt((r2.start + r2.end) / 2), { rep: 2, done: 1 });
  assert.deepEqual(set.repAt(set.duration), { rep: 0, done: 3 });
  assert.deepEqual(set.repAt(0), { rep: 0, done: 0 });
  for (const kind of KINDS) {
    const long = makeLiftSet(kind, { reps: 7 });
    for (let i = 0; i <= 600; i++) {
      const t = (long.duration * i) / 600;
      let rep = 0, done = 0;
      for (const s of long.timeline) {
        const m = /^rep (\d+)$/.exec(s.name);
        if (!m) continue;
        if (t >= s.end) done = Number(m[1]); else if (t >= s.start) rep = Number(m[1]);
      }
      assert.deepEqual(long.repAt(t), { rep, done }, `${kind} t=${t.toFixed(3)}`);
    }
  }
});

test("a lift that is none of the six is refused with a plain error; reps of infinity count as the most", () => {
  assert.throws(() => makeLiftSet("front-squat" as never, { reps: 3 }), /unknown lift front-squat/);
  assert.throws(() => buildLiftSet("curl" as never, 3), /unknown lift curl/);
  assert.equal(makeLiftSet("bench", { reps: Infinity }).reps, 30);
  assert.equal(makeLiftSet("bench", { reps: -Infinity }).reps, 1);
});

test("heroTime shows the lift at a glance: the bottom, the touch, the bar at the knees", () => {
  const bottom = (kind: LiftKind) => {
    const set = makeLiftSet(kind, { reps: 2 }), s = M.sample(set), r1 = s.rep(1);
    return { set, s, r1, p: set.pose(set.heroTime) };
  };
  for (const kind of ["squat-low", "squat-high"] as const) {
    const { s, r1, p } = bottom(kind);
    let lowest = 9;
    for (let i = s.idx(r1.start); i <= s.idx(r1.end); i++) lowest = Math.min(lowest, s.poses[i].bar[1]);
    assert.ok(p.bar[1] - lowest < 0.002, `${kind}: the bottom of rep 1`);
    assert.ok(p.gripping);
    assert.ok(Math.abs(p.hand.R[2]) > 0.25 && Math.abs(p.hand.L[2]) > 0.25, "both hands out at the bar");
  }
  for (const kind of ["bench", "bench-close"] as const) {
    const { s, r1, p } = bottom(kind);
    let lowest = 9;
    for (let i = s.idx(r1.start); i <= s.idx(r1.end); i++) lowest = Math.min(lowest, s.poses[i].bar[1]);
    assert.ok(p.bar[1] - lowest < 0.002, `${kind}: the touch of rep 1`);
  }
  for (const kind of ["deadlift-conventional", "deadlift-sumo"] as const) {
    const { set, s, r1, p } = bottom(kind);
    const rest = s.poses[0].bar[1];
    assert.ok(p.bar[1] > rest + 0.2 && p.bar[1] < rest + 0.33, `${kind}: the bar is at the knees, the back angle still held (${(p.bar[1] - rest).toFixed(3)} m)`);
    assert.ok(set.heroTime > r1.start && set.heroTime < r1.end);
  }
});

test("the scene matches the poses: the bar in the hooks, on the floor, the bench under the lifter", () => {
  for (const kind of KINDS) {
    const set = makeLiftSet(kind, { reps: 2 });
    const p0 = set.pose(0), pE = set.pose(set.duration), sc = set.scene;
    assert.equal(sc.family, liftFamily(kind));
    if (sc.family === "deadlift") {
      assert.equal(sc.rack, null); assert.equal(sc.bench, null);
      assert.ok(sc.barRestY !== null && Math.abs(sc.barRestY - p0.bar[1]) < 1e-9 && Math.abs(sc.barRestY - pE.bar[1]) < 1e-9);
      assert.equal(sc.barRestY, 0.225, "a 25 kg plate has a 0.225 m radius");
    } else {
      assert.equal(sc.barRestY, null);
      assert.ok(sc.rack);
      assert.ok(Math.abs(sc.rack!.barX - p0.bar[0]) < 1e-9 && Math.abs(sc.rack!.barY - p0.bar[1]) < 1e-9, "the bar starts in the hooks");
      assert.ok(Math.abs(sc.rack!.barX - pE.bar[0]) < 1e-9 && Math.abs(sc.rack!.barY - pE.bar[1]) < 1e-9, "and ends there");
      assert.ok(sc.rack!.halfWidth > 0.5 && sc.rack!.halfWidth < 0.655, "the uprights stand between the plates");
      assert.ok(sc.rack!.height > sc.rack!.barY);
    }
    if (sc.family === "bench") {
      assert.ok(sc.bench && sc.bench.headX < p0.head[0] - 0.1 && sc.bench.footX > Math.max(p0.ankle.R[0], p0.ankle.L[0]) - 0.05);
      assert.equal(sc.bench!.top, 0.44);
      assert.ok(sc.rack!.x < sc.rack!.barX, "the posts stand behind the bar, toward the head");
    } else assert.equal(sc.bench, null);
    if (sc.family === "squat") assert.ok(sc.rack!.x > sc.rack!.barX, "the posts stand ahead of the bar, the lifter faces them");
  }
});

// ------------------------------------------------------------------------------------------------ purity and cost
test("pose(t) is a pure function of t: the order of the calls changes nothing, and t is clamped to the set", () => {
  for (const kind of KINDS) {
    const set = makeLiftSet(kind, { reps: 2 });
    const times = Array.from({ length: 60 }, (_, i) => (set.duration * ((i * 37) % 60)) / 59);
    const first = times.map((t) => JSON.stringify(set.pose(t)));
    const again = [...times].reverse().map((t) => JSON.stringify(set.pose(t))).reverse();
    assert.deepEqual(again, first);
    assert.equal(JSON.stringify(set.pose(-3)), JSON.stringify(set.pose(0)));
    assert.equal(JSON.stringify(set.pose(set.duration + 3)), JSON.stringify(set.pose(set.duration)));
    const a = set.pose(1), b = set.pose(1);
    assert.notEqual(a, b, "every call returns its own pose");
    assert.notEqual(a.hand.R, b.hand.R);
    // a fresh build of the same table gives the same set
    const other = buildLiftSet(kind, 2);
    assert.equal(JSON.stringify(other.pose(set.duration / 3)), JSON.stringify(set.pose(set.duration / 3)));
    assert.equal(other.duration, set.duration);
  }
});

test("pose(t) is cheap: a frame costs microseconds (the limit is a hundred times that, for a loaded machine)", () => {
  for (const kind of KINDS) {
    const set = makeLiftSet(kind, { reps: 30 });
    set.pose(1);
    const n = 5000;
    const t0 = process.hrtime.bigint();
    let acc = 0;
    for (let i = 0; i < n; i++) acc += set.pose((set.duration * i) / n).bar[1];
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    assert.ok(Number.isFinite(acc));
    assert.ok(ms < 2.5, `${kind}: ${ms.toFixed(4)} ms per frame`);
  }
});

test("building a set (calibration included) takes a fraction of a second (the limit is ten times that, for a loaded machine)", () => {
  for (const kind of KINDS) {
    const t0 = Date.now();
    buildLiftSet(kind, 30);
    assert.ok(Date.now() - t0 < 4000, `${kind} took ${Date.now() - t0} ms`);
  }
});

test("a short set moves alike rep after rep; in a long set the reps near the end grind", () => {
  for (const kind of KINDS) {
    const lens = (reps: number) => makeLiftSet(kind, { reps }).timeline.filter((s) => /^rep /.test(s.name)).map((s) => s.end - s.start);
    for (const reps of [1, 2, 3, 4]) {
      const l = lens(reps);
      assert.ok(Math.max(...l) - Math.min(...l) < 1e-9, `${kind}: ${reps} reps are alike`);
    }
    for (const reps of [5, 8, 30]) {
      const l = lens(reps);
      assert.ok(Math.abs(l[0] - lens(1)[0]) < 1e-9, "the first rep is the rep of a single");
      for (let i = 1; i < l.length; i++) assert.ok(l[i] >= l[i - 1] - 1e-9, `${kind}: rep ${i + 1} of ${reps} is no quicker than the one before`);
      const last = l[l.length - 1] / l[0];
      assert.ok(last > 1.15 && last < 1.45, `${kind}: the last of ${reps} reps takes ${last.toFixed(2)} times the first`);
    }
  }
});

test("the last rep of a set is slower in its sticking region and in its peak speed, not only longer", () => {
  for (const kind of KINDS) {
    const set = makeLiftSet(kind, { reps: 8 }), s = M.sample(set);
    const bs = M.speedSeries(s.poses.map((p) => p.bar));
    const lifting = new Set(["ascent", "press", "pull"]);
    const peak = (k: number) => { const r = s.rep(k); let v = 0; for (let i = s.idx(r.start); i <= s.idx(r.end); i++) if (lifting.has(set.phase(s.times[i]))) v = Math.max(v, bs[i]); return v; };
    assert.ok(peak(8) < peak(1) - 0.03, `${kind}: the ascent of rep 8 peaks at ${peak(8).toFixed(3)}, that of rep 1 at ${peak(1).toFixed(3)} m/s`);
  }
});

test("the pose is continuous across the rep boundaries of a 30-rep set (the rep position changes the tempo, never the pose)", () => {
  for (const kind of KINDS) {
    const set = makeLiftSet(kind, { reps: 30 });
    for (const seg of set.timeline.filter((x) => /^rep /.test(x.name))) {
      const a = set.pose(seg.start - 1e-6), b = set.pose(seg.start + 1e-6);
      assert.ok(M.dist(a.pelvis, b.pelvis) < 1e-4 && M.dist(a.bar, b.bar) < 1e-4, `${kind} ${seg.name}`);
    }
  }
});

// ------------------------------------------------------------------------------------------------ mutations: the tests must bite
type Mutation = {
  name: string;
  kinds: LiftKind[];
  /** A pose change at time t; the set it is applied to is given for the timeline. */
  pose?: (p: Mutable, t: number, set: LiftSet) => void;
  /** A change of the tables; returns the function that puts them back. */
  tables?: () => () => void;
  pairs?: boolean;
};
type Mutable = { -readonly [K in keyof LiftPose]: LiftPose[K] extends readonly number[] ? [number, number, number] : LiftPose[K] extends { R: unknown; L: unknown } ? { R: [number, number, number]; L: [number, number, number] } : LiftPose[K] };

const clone = (p: LiftPose): Mutable => JSON.parse(JSON.stringify(p));
const segment = (set: LiftSet, name: string) => set.timeline.find((s) => s.name === name)!;
const inReps = (set: LiftSet, t: number) => { const r1 = segment(set, "rep 1"), rl = set.timeline.filter((s) => /^rep /.test(s.name)).pop()!; return t >= r1.start && t <= rl.end; };
const shiftBody = (p: Mutable, dx: number, dy = 0, dz = 0) => {
  for (const k of ["pelvis", "waist", "chest", "head"] as const) p[k] = [p[k][0] + dx, p[k][1] + dy, p[k][2] + dz];
  for (const j of ["hip", "knee", "shoulder", "elbow", "wrist", "hand"] as const) for (const s of M.SIDES) p[j][s] = [p[j][s][0] + dx, p[j][s][1] + dy, p[j][s][2] + dz];
};
const tweak = <T extends Record<string, any>>(table: T, patch: Partial<T>) => { const old = { ...table }; Object.assign(table, patch); return () => { Object.assign(table, old); }; };

const MUTATIONS: Mutation[] = [
  {
    name: "a knee bent backwards", kinds: ["squat-low", "deadlift-conventional"],
    pose: (p) => { for (const s of M.SIDES) p.knee[s] = [p.hip[s][0] + p.ankle[s][0] - p.knee[s][0], p.hip[s][1] + p.ankle[s][1] - p.knee[s][1], p.hip[s][2] + p.ankle[s][2] - p.knee[s][2]]; },
  },
  {
    name: "a planted foot slides", kinds: ["squat-high", "deadlift-sumo", "bench"],
    pose: (p, t, set) => { if (inReps(set, t)) { const d = 0.03 * (t - segment(set, "rep 1").start) / 4; for (const part of ["ankle", "heel", "toe"] as const) p[part].R = [p[part].R[0] + d, p[part].R[1], p[part].R[2]]; } },
  },
  {
    name: "a jump of 4 cm at the end of rep 1", kinds: ["deadlift-conventional", "squat-low", "bench-close"],
    pose: (p, t, set) => { if (t >= segment(set, "rep 1").end) shiftBody(p, 0.04); },
  },
  {
    name: "a pop of 3 cm at the let-go", kinds: ["deadlift-sumo", "squat-high"],
    pose: (p, t, set) => { if (t >= segment(set, "let go").start) shiftBody(p, 0, 0.03); },
  },
  {
    name: "low bar and high bar swapped", kinds: ["squat-low", "squat-high"], pairs: true,
    tables: () => { const low = LIFT_TABLES.squat["squat-low"], high = LIFT_TABLES.squat["squat-high"]; const a = { ...low }, b = { ...high }; Object.assign(low, b); Object.assign(high, a); return () => { Object.assign(low, a); Object.assign(high, b); }; },
  },
  {
    name: "sumo hands outside the knees", kinds: ["deadlift-sumo"],
    tables: () => tweak(LIFT_TABLES.deadlift["deadlift-sumo"], { grip: 0.5 }),
  },
  {
    name: "a rushed squat rep", kinds: ["squat-low", "squat-high"],
    tables: () => { const hi = LIFT_TABLES.squat["squat-high"], lo = LIFT_TABLES.squat["squat-low"]; const a = tweak(lo, { down: 0.6, up: 0.5, lockout: 0.1 }), b = tweak(hi, { down: 0.6, up: 0.5, lockout: 0.1 }); return () => { a(); b(); }; },
  },
  {
    name: "a rushed deadlift pull", kinds: ["deadlift-conventional", "deadlift-sumo"],
    tables: () => { const c = LIFT_TABLES.deadlift["deadlift-conventional"], s = LIFT_TABLES.deadlift["deadlift-sumo"]; const a = tweak(c, { tempo: { lead: 0.08, pull: 0.7, hold: 0.42, lower: 0.5, floor: 0.2 } }), b = tweak(s, { tempo: { lead: 0.08, pull: 0.7, hold: 0.42, lower: 0.5, floor: 0.2 } }); return () => { a(); b(); }; },
  },
  {
    name: "the bar drifts forward over the toes during the set", kinds: ["squat-high", "deadlift-conventional"],
    pose: (p, t, set) => { if (inReps(set, t)) { const d = 0.05 * (t - segment(set, "rep 1").start) / (set.duration - segment(set, "rep 1").start); p.bar = [p.bar[0] + d, p.bar[1], p.bar[2]]; for (const s of M.SIDES) p.hand[s] = [p.hand[s][0] + d, p.hand[s][1], p.hand[s][2]]; } },
  },
  {
    name: "a hand lets go of the bar by 3 cm while gripping", kinds: ["bench", "squat-low", "deadlift-sumo"],
    pose: (p) => { if (p.gripping) p.hand.R = [p.hand.R[0], p.hand.R[1] + 0.03, p.hand.R[2]]; },
  },
  {
    name: "the bar is not level (one hand 2 cm higher, the bar tilted with it)", kinds: ["bench-close"],
    pose: (p) => { if (p.gripping) { p.hand.R = [p.hand.R[0], p.hand.R[1] + 0.02, p.hand.R[2]]; p.wrist.R = [p.wrist.R[0], p.wrist.R[1] + 0.02, p.wrist.R[2]]; } },
  },
  {
    name: "a forearm 10% too long", kinds: ["squat-low", "bench", "deadlift-conventional"],
    pose: (p) => { const e = p.elbow.R, w = p.wrist.R; p.wrist.R = [e[0] + (w[0] - e[0]) * 1.1, e[1] + (w[1] - e[1]) * 1.1, e[2] + (w[2] - e[2]) * 1.1]; },
  },
  {
    name: "the head nods 2 cm on every bench rep", kinds: ["bench", "bench-close"],
    pose: (p, t, set) => { if (inReps(set, t)) p.head = [p.head[0], p.head[1] + 0.02 * Math.sin(t * 3), p.head[2]]; },
  },
  {
    name: "one frame of NaN", kinds: ["squat-low", "bench", "deadlift-sumo"],
    pose: (p, t, set) => { if (Math.abs(t - set.duration / 2) < 0.002) p.pelvis = [Number.NaN, p.pelvis[1], p.pelvis[2]]; },
  },
  {
    name: "the close grip as wide as the bench grip", kinds: ["bench-close"], pairs: true,
    tables: () => tweak(LIFT_TABLES.bench["bench-close"], { grip: 0.38, touch: 0.135, lead: 0.01 }),
  },
  {
    name: "lowering the deadlift as the exact reverse of the pull", kinds: ["deadlift-conventional", "deadlift-sumo"],
    tables: () => { const c = LIFT_TABLES.deadlift["deadlift-conventional"], s = LIFT_TABLES.deadlift["deadlift-sumo"]; const a = tweak(c, { downExp: c.upExp, downHold: 1 }), b = tweak(s, { downExp: s.upExp, downHold: 1 }); return () => { a(); b(); }; },
  },
  {
    name: "heels lift off during the squat reps", kinds: ["squat-low", "squat-high"],
    pose: (p, t, set) => { if (inReps(set, t)) for (const s of M.SIDES) { p.heel[s] = [p.heel[s][0], p.heel[s][1] + 0.02, p.heel[s][2]]; } },
  },
  {
    name: "the head pushed into the high-bar squat's bar", kinds: ["squat-high"],
    pose: (p) => { p.head = [p.head[0] - 0.12, p.head[1] - 0.05, p.head[2]]; },
  },
  {
    name: "the bar set into the shins", kinds: ["deadlift-conventional"],
    tables: () => tweak(LIFT_TABLES.deadlift["deadlift-conventional"], { barAhead: 0.05 }),
  },
  {
    name: "the rack three times too low", kinds: ["squat-low"],
    tables: () => tweak(LIFT_TABLES.squatShared, { rackDrop: 0.2 }),
  },
  {
    name: "the walkout without double support", kinds: ["squat-low"],
    tables: () => tweak(LIFT_TABLES.squatShared, { gap: 0.02 }),
  },
  {
    name: "a bench lifter with the elbows glued to the ribs on the close grip (16 cm ahead of the bar)", kinds: ["bench-close"],
    tables: () => tweak(LIFT_TABLES.bench["bench-close"], { lead: 0.16 }),
  },
  {
    name: "a stiff-legged lockout (the knees locked at 180 degrees)", kinds: ["deadlift-conventional"],
    pose: (p, t, set) => { const r1 = segment(set, "rep 1"); if (t > r1.start + 2 && t < r1.start + 2.4) for (const s of M.SIDES) p.knee[s] = [(p.hip[s][0] + p.ankle[s][0]) / 2, (p.hip[s][1] + p.ankle[s][1]) / 2, (p.hip[s][2] + p.ankle[s][2]) / 2]; },
  },

  {
    name: "a lifter who never stands up under the bar (the legs stay bent 23 degrees at every lockout)", kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { standReach: 0.98, maxReach: 0.99, walkReach: 0.98 }),
  },
  {
    name: "arms that hang through the thighs on the step out", kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { hangOut: 0.03 }),
  },
  {
    name: "the bar pressed a further 2 cm into the drawn chest", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { sink: 0.023 }), b = tweak(LIFT_TABLES.bench["bench-close"], { sink: 0.023 }); return () => { a(); b(); }; },
  },
  {
    name: "a walkout with the feet kicked up 14 cm at every step", kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { stepLift: 0.14 }),
  },
  {
    name: "the deadlifter ends in a quarter squat", kinds: ["deadlift-conventional", "deadlift-sumo"],
    pose: (p, t, set) => { if (t > set.duration - 0.4) for (const s of M.SIDES) p.knee[s] = [p.knee[s][0] + 0.09, p.knee[s][1], p.knee[s][2]]; },
  },
  {
    name: "the sumo lifter's hands hang through his thighs at the end", kinds: ["deadlift-sumo"],
    pose: (p, t, set) => { if (t > set.duration - 1.0) for (const s of M.SIDES) { p.hand[s] = [p.hand[s][0], p.hand[s][1], p.hand[s][2] * 0.55]; p.wrist[s] = [p.wrist[s][0], p.wrist[s][1], p.wrist[s][2] * 0.55]; } },
  },
  {
    name: "the pelvis shivers 4 mm at 25 Hz through the reps", kinds: ["squat-low", "squat-high"],
    pose: (p, t, set) => { if (inReps(set, t)) shiftBody(p, 0, 0.004 * Math.sin(t * 157)); },
  },
  // ---- the squat's rack, knee, stop and release; the bench's contact and ending; the deadlift's lowering, bar and walk-up
  {
    name: "a squatter who stands up at the rack while the bar is still in the hooks behind him", kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { rise: { from: -3, dur: 0.1 } }),
  },
  {
    name: "the knee dives forward in mid-descent and comes back (the loop of the knee)", kinds: ["squat-low", "squat-high"],
    pose: (p, t, set) => {
      if (!inReps(set, t)) return;
      const r1 = segment(set, "rep 1"), len = r1.end - r1.start, u = (((t - r1.start) % len) + len) % len / len;
      for (const s of M.SIDES) p.knee[s] = [p.knee[s][0] + 0.07 * Math.sin(Math.PI * u), p.knee[s][1], p.knee[s][2]];
    },
  },
  {
    name: "the bar stops dead at the bottom (a constant braking of 12 m/s2) and jumps off it", kinds: ["squat-low", "squat-high"],
    tables: () => {
      const sh = LIFT_TABLES.squatShared as any;
      const d = sh.descent, a = sh.ascent;
      sh.descent = { start: { w: 0.25 }, end: { a: 12 }, base: [[0, 0.5], [0.3, 0.65], [0.6, 0.62], [0.9, 0.35], [1, 0.3]] };
      sh.ascent = { start: { a: 10 }, end: { w: 0.3 }, base: [[0, 0.52], [0.08, 0.54], [0.22, 0.45], [0.44, 0.32], [0.7, 0.62], [0.9, 0.42], [1, 0.3]] };
      return () => { sh.descent = d; sh.ascent = a; };
    },
  },
  {
    name: "the high-bar lifter's hands drop through his shoulders and trunk at the release", kinds: ["squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { release: { ...LIFT_TABLES.squatShared.release, elbowLead: 0.1, elbowOut: -0.9 } }),
  },
  {
    name: "a low-bar stance only as wide as the high bar's", kinds: ["squat-low"], pairs: true,
    tables: () => tweak(LIFT_TABLES.squat["squat-low"], { stance: 0.21 }),
  },
  {
    name: "bench forearms leaning back at the touch (the elbows 7 cm ahead of the bar)", kinds: ["bench"],
    tables: () => tweak(LIFT_TABLES.bench.bench, { lead: 0.07 }),
  },
  {
    name: "a flat lifter: the shoulders not set back onto the pad and the bar in the fingers (0.48 m of bar travel)", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { shoulderSet: 0, palm: 0.08 }),
  },
  {
    name: "the elbows follow the bar back toward the head at once: rotated all the way out long before lockout", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { elbowLag: 0 }),
  },
  {
    name: "the elbows on one track down and up: they do not open as the bar is pressed back over the shoulders", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { elbowLag: 1 }),
  },
  {
    name: "the elbows follow 60% of the bar's early return instead of half", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { elbowLag: 0.4 }),
  },
  {
    name: "the bar's path bowed half as much, down and up", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { bow: [0.17, 0.32] }), b = tweak(LIFT_TABLES.bench["bench-close"], { bow: [0.17, 0.32] }); return () => { a(); b(); }; },
  },
  {
    name: "the rack hooks 3 cm too high for the lifter", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { hookY: 1.055 }),
  },
  {
    name: "the rack hooks 3 cm too low for the lifter", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { hookY: 0.995 }),
  },
  {
    name: "a novice's press: the bar straight up off the chest first, back over the shoulders last", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { bow: [0.34, -0.6] }), b = tweak(LIFT_TABLES.bench["bench-close"], { bow: [0.34, -0.6] }); return () => { a(); b(); }; },
  },
  {
    name: "the bar on one straight line down and up", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { bow: [0, 0] }), b = tweak(LIFT_TABLES.bench["bench-close"], { bow: [0, 0] }); return () => { a(); b(); }; },
  },
  {
    name: "the close grip's elbows flared like the bench's (under the bar at the chest)", kinds: ["bench-close"],
    tables: () => tweak(LIFT_TABLES.bench["bench-close"], { lead: 0 }),
  },
  {
    name: "the grips of the first drawing (hands 0.67 and 0.416 m apart)", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { grip: 0.335 }), b = tweak(LIFT_TABLES.bench["bench-close"], { grip: 0.208 }); return () => { a(); b(); }; },
  },
  {
    name: "arms that never lock out on the bench (165 degrees)", kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { armMax: 0.5772, lockMargin: 0.0015 }),
  },
  {
    name: "the bench lifter ends with his hands up in a V, the elbows floating 0.24 m above the pad", kinds: ["bench"],
    tables: () => tweak(LIFT_TABLES.benchShared, { restHand: [0.3, 0.77, 0.12], restVec: [0.287, -0.958, 0], restPole: [0.1, -0.6, 1] } as any),
  },
  {
    name: "the sumo lifter's fists pressed into the thighs at lockout (the shoulders only 0.10 m behind the bar)", kinds: ["deadlift-sumo"],
    tables: () => tweak(LIFT_TABLES.deadlift["deadlift-sumo"], { dxsLock: -0.102 }),
  },
  {
    name: "the hips snap back at the start of the lowering (a 4 cm step of the whole body in 20 ms)", kinds: ["deadlift-conventional", "deadlift-sumo"],
    pose: (p, t, set) => {
      const r1 = segment(set, "rep 1"), T = (LIFT_TABLES.deadlift as any)[set.kind].tempo, t0 = r1.start + T.lead + T.pull + T.hold;
      if (t >= t0 && t < r1.end) shiftBody(p, -0.04 * Math.min(1, (t - t0) / 0.02));
    },
  },
  {
    name: "the conventional bar set 1.2 cm into the drawn calf", kinds: ["deadlift-conventional"],
    tables: () => tweak(LIFT_TABLES.deadlift["deadlift-conventional"], { barAhead: 0.118 }),
  },
  {
    name: "the walk up with the arms swung through the hips", kinds: ["deadlift-conventional"],
    tables: () => tweak(LIFT_TABLES.deadlift["deadlift-conventional"], { handOut: 0.0 }),
  },
  {
    name: "a forearm swung through the thigh: the free hand dragged 5 cm toward the body", kinds: ["deadlift-conventional"],
    pose: (p, t, set) => { if (!p.gripping && t < segment(set, "grip").start) for (const s of M.SIDES) p.hand[s] = [p.hand[s][0], p.hand[s][1], p.hand[s][2] * 0.4]; },
  },
  // ---- the squat's release, arm hang and speed; the bench's landing and press speed; the deadlift's pull, lowering and walk-up
  {
    name: "the squat release unfolds the forearm through the front (no back swing, 1.3 s, a half-cosine drop)", kinds: ["squat-low", "squat-high"],
    tables: () => { const sh = LIFT_TABLES.squatShared as any; const r = sh.release, g = sh.letGo; sh.release = { ...r, elbowBack: 0, speed: [[0, 0], [0.5, 1], [1, 0]] }; sh.letGo = 1.3; return () => { sh.release = r; sh.letGo = g; }; },
  },
  {
    name: "the squat arms hang too close to the thigh (the free mitt grazes it at the step out)", kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { hangOut: 0.09 }),
  },
  {
    name: "a squat rep too slow (the 8-rep set over 31 s)", kinds: ["squat-low", "squat-high"],
    tables: () => { const lo = LIFT_TABLES.squat["squat-low"], hi = LIFT_TABLES.squat["squat-high"]; const a = tweak(lo, { up: 1.4, lockout: 0.2 }), b = tweak(hi, { up: 1.4, lockout: 0.2 }); return () => { a(); b(); }; },
  },
  {
    name: "a bench press that ends its descent with a corner in the velocity (the soft landing cut to 2%)", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { downTail: 0.02 }), b = tweak(LIFT_TABLES.bench["bench-close"], { downTail: 0.02 }); return () => { a(); b(); }; },
  },
  {
    name: "a bench press ascent 12% quicker than its tempo (the peak speed leaves its band)", kinds: ["bench", "bench-close"],
    tables: () => { const a = tweak(LIFT_TABLES.bench.bench, { up: 0.93 }), b = tweak(LIFT_TABLES.bench["bench-close"], { up: 0.97 }); return () => { a(); b(); }; },
  },
  {
    name: "a conventional deadlift lowering at 0.85 m/s peak (the middle of the lowering fast)", kinds: ["deadlift-conventional"],
    tables: () => tweak(LIFT_TABLES.deadlift["deadlift-conventional"], { lowerPeak: 0.95, tempo: { lead: 0.103, pull: 1.63, hold: 0.31, lower: 1.1, floor: 0.31 } }),
  },
  {
    name: "a deadlift pull that leaves the floor too soon (0.154 s by 2 mm) and too fast at first", kinds: ["deadlift-conventional", "deadlift-sumo"],
    tables: () => { const c = LIFT_TABLES.deadlift["deadlift-conventional"], s = LIFT_TABLES.deadlift["deadlift-sumo"]; const a = tweak(c, { tempo: { ...c.tempo, lead: 0.08 }, pullStart: 0.3 }), b = tweak(s, { tempo: { ...s.tempo, lead: 0.08 } }); return () => { a(); b(); }; },
  },
  {
    name: "a sumo walk-up with the wide landing too quick (knee acceleration 93 m/s2)", kinds: ["deadlift-sumo"],
    tables: () => tweak(LIFT_TABLES.deadliftShared, { wideScale: 1, walkReach: 0.841 }),
  },
  {
    name: "a walk-up with steps of 0.40 s and an arm swing of 41 degrees", kinds: ["deadlift-conventional", "deadlift-sumo"],
    tables: () => tweak(LIFT_TABLES.deadliftShared, { stepDur: 0.46, swing: 0.8 }),
  },
  // ---- a brisk walk in, a long dead time in the rack, a quick stand up, hands held in the air
  {
    name: "a brisk walk in (steps of 0.35 s), and a walkout that is as brisk",
    kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { stepDur: [0.35, 0.4, 0.35] } as any),
  },
  {
    name: "the lifter stands in the rack for 2.4 s after the bar is racked, the arms swinging back",
    kinds: ["squat-low", "squat-high"],
    tables: () => tweak(LIFT_TABLES.squatShared, { letGo: 2.4 }),
  },
  {
    name: "a deadlifter who hinges to the bar and stands up again in half the time",
    kinds: ["deadlift-conventional", "deadlift-sumo"],
    tables: () => tweak(LIFT_TABLES.deadliftShared, { hinge: 0.6, letGo: 0.7 }),
  },
  {
    name: "the bench lifter's hands rest in the air above the chest, the elbows out wide",
    kinds: ["bench", "bench-close"],
    tables: () => tweak(LIFT_TABLES.benchShared, { restHand: [0.32, 0.74, 0.16], restPole: [0.5, -1.5, 2] } as any),
  },
];

function mutantSet(kind: LiftKind, reps: number, m: Mutation): LiftSet {
  const base = m.tables ? buildLiftSet(kind, reps) : makeLiftSet(kind, { reps });
  if (!m.pose) return base;
  const apply = m.pose;
  return { ...base, pose: (t: number) => { const p = clone(base.pose(t)); apply(p, t, base); return p as unknown as LiftPose; } };
}

/** Runs the whole suite on the mutated model; returns the checks that failed (a check that throws has failed). */
function failuresUnder(m: Mutation, kind: LiftKind): string[] {
  const restore = m.tables?.();
  const cache = new Map<string, LiftSet>();
  const previous = source.make;
  source.make = (k, reps) => { const key = k + reps; if (!cache.has(key)) cache.set(key, mutantSet(k, reps, m)); return cache.get(key)!; };
  const failed: string[] = [];
  const run = (f: () => Check[]) => { try { for (const c of f()) if (!passes(c)) failed.push(c.id); } catch (error) { failed.push(`threw: ${String(error).slice(0, 60)}`); } };
  try {
    run(() => suite(kind));
    if (m.pairs) run(pairChecks);
  } finally {
    source.make = previous;
    restore?.();
  }
  return failed;
}

const mutations = process.env.LIFT_MUTATIONS ? test : test.skip;
mutations("the mutation table has at least twelve entries, and covers every family", () => {
  assert.ok(MUTATIONS.length >= 12);
  const kinds = new Set(MUTATIONS.flatMap((m) => m.kinds.map(liftFamily)));
  assert.deepEqual([...kinds].sort(), ["bench", "deadlift", "squat"]);
});

mutations("the unmutated model passes the whole suite (the mutation tests start from green)", () => {
  for (const kind of KINDS) {
    const failed = suite(kind).filter((c) => !passes(c));
    assert.deepEqual(failed.map(show), []);
  }
});

for (const m of MUTATIONS) {
  for (const kind of m.kinds) {
    mutations(`mutation: ${m.name} (${kind}) makes the suite fail`, () => {
      const failed = failuresUnder(m, kind);
      if (process.env.MUTATION_REPORT) console.log(`MUT ${m.name} | ${kind} | ${failed.length} checks fail | ${failed.slice(0, 3).map((f) => f.replace(kind + ": ", "")).join(" ; ")}`);
      assert.ok(failed.length > 0, `nothing noticed: ${m.name} on ${kind}`);
      // the model is whole again afterwards
      assert.deepEqual(suite(kind).filter((c) => !passes(c)).map(show), []);
    });
  }
}
