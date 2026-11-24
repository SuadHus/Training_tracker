// The invariants every lift keeps, as Checks (so that the mutation tests can see them fail).
import * as M from "./measure";
import { type Check, getSet } from "./check";
import { repSegments } from "../../../src/lib/lift-set";
import { LIFT_KINDS, liftFamily, type LiftKind } from "../../../src/lib/lifts";

export function generalChecks(kind: LiftKind, reps = 2): Check[] {
  const set = getSet(kind, reps);
  const s = M.sample(set);
  const fam = liftFamily(kind);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });

  // ---- bones, numbers, joints
  const br = M.boneRange(s);
  c("bone lengths constant, worst range (m)", Math.max(...Object.values(br)), 0, 1e-9);
  let nan = 0, minBulge = 9, maxKnee = 0, maxElbow = 0, floor = 9;
  for (const p of s.poses) {
    for (const [, v] of M.jointList(p)) if (!v.every(Number.isFinite)) nan++;
    for (const sd of M.SIDES) {
      minBulge = Math.min(minBulge, M.kneeBulge(p, sd));
      maxKnee = Math.max(maxKnee, M.kneeAngle(p, sd));
      maxElbow = Math.max(maxElbow, M.elbowAngle(p, sd));
      floor = Math.min(floor, p.heel[sd][1], p.toe[sd][1], p.ankle[sd][1] - 0.08);
    }
  }
  c("no NaN or Infinity in any joint (count)", nan, 0, 0);
  c("chest to head centre (m)", M.dist(s.poses[0].chest, s.poses[0].head), fam === "bench" ? 0.19 : 0.255 - 1e-9, fam === "bench" ? 0.22 : 0.255 + 1e-9);
  c("knees bend the anatomical way (min bulge, m)", minBulge, 0.001, 9);
  c("knees never straight (max angle, deg)", maxKnee, 0, 178.9);
  c("elbows never past straight (max angle, deg)", maxElbow, 0, 178.9);
  c("no foot below the floor (m)", floor, -1e-9, 9);

  // ---- hands and bar
  let handDev = 0, level = 0, handSpread = 0;
  for (const p of s.poses) {
    if (!p.gripping) continue;
    for (const sd of M.SIDES) handDev = Math.max(handDev, Math.hypot(p.hand[sd][0] - p.bar[0], p.hand[sd][1] - p.bar[1]));
    level = Math.max(level, Math.abs(p.hand.R[1] - p.hand.L[1]), Math.abs(p.hand.R[0] - p.hand.L[0]));
    handSpread = Math.max(handSpread, Math.abs(p.hand.R[2] + p.hand.L[2] - 2 * p.bar[2]));
  }
  c("hands on the bar while gripping, worst (m)", handDev, 0, 0.001);
  c("bar level while gripping (hands at the same height and x, m)", level, 0, 0.001);
  c("hands symmetric about the bar centre (m)", handSpread, 0, 0.001);
  c("some frames grip (count > 0)", s.poses.filter((p) => p.gripping).length, 1, Infinity);

  // ---- bar over the midfoot (squat, deadlift)
  if (fam !== "bench") {
    const r1 = s.rep(1), rL = s.rep(reps);
    let worst = 0;
    for (let i = s.idx(r1.start); i <= s.idx(rL.end); i++) {
      const p = s.poses[i];
      worst = Math.max(worst, Math.abs(p.bar[0] - (M.mean(M.SIDES.map((sd) => p.ankle[sd][0])) + (fam === "squat" ? 0.07 : 0.1))));
    }
    c("bar over the midfoot during the reps, worst (m): the squat bar over ankle + 0.07, the deadlift bar 0.1 ahead of the ankle (a little over the midfoot, so that it clears the drawn calves)", worst, 0, fam === "squat" ? 0.01 : 0.03);
  }

  // ---- stillness of the feet in the reps (planted feet neither slide nor sink)
  {
    const r1 = s.rep(1), rL = s.rep(reps), a = s.poses[s.idx(r1.start)];
    let slide = 0, lift = 0;
    for (let i = s.idx(r1.start); i <= s.idx(rL.end); i++) for (const sd of M.SIDES) {
      slide = Math.max(slide, M.dist(s.poses[i].ankle[sd], a.ankle[sd]));
      lift = Math.max(lift, s.poses[i].heel[sd][1], s.poses[i].toe[sd][1]);
    }
    c("feet planted through the reps: ankle drift (m)", slide, 0, 0.001);
    c("feet planted through the reps: heel and toe height (m)", lift, 0, 0.001);
  }

  // ---- continuity
  const jump = M.maxJump(s);
  c("continuity: no joint moves more than 1 cm in 1/240 s (cm)", jump.cm, 0, 1);

  // ---- timeline
  const tl = set.timeline;
  let contiguous = 1;
  for (let i = 1; i < tl.length; i++) if (Math.abs(tl[i].start - tl[i - 1].end) > 1e-9 || tl[i].end <= tl[i].start) contiguous = 0;
  c("timeline: contiguous, positive lengths (1 = yes)", contiguous, 1, 1);
  c("timeline: starts at 0 (s)", Math.abs(tl[0].start), 0, 1e-9);
  c("timeline: ends at the duration (s)", Math.abs(tl[tl.length - 1].end - set.duration), 0, 1e-9);
  const repNames = repSegments(tl).map((x) => x.name);
  c("timeline: reps named rep 1 .. rep n in order (1 = yes)", repNames.length === reps && repNames.every((n, i) => n === `rep ${i + 1}`) ? 1 : 0, 1, 1);
  c("timeline: names are plain lower-case words (1 = yes)", tl.every((x) => /^(rep \d+|[a-z-]+( [a-z-]+)*)$/.test(x.name)) ? 1 : 0, 1, 1);
  let quiet = 1;
  for (let i = 0; i <= 200; i++) if (!/^([a-z-]+( [a-z-]+)?|on the floor)$/.test(set.phase((set.duration * i) / 200))) quiet = 0;
  c("phase(t) is one or two quiet lower-case words everywhere (1 = yes)", quiet, 1, 1);

  // ---- hero time
  {
    const p = set.pose(set.heroTime);
    c("heroTime lies inside the set (s)", set.heroTime, 0, set.duration);
    c("heroTime: both hands on the bar (1 = yes)", p.gripping ? 1 : 0, 1, 1);
    const r1 = s.rep(1);
    c("heroTime lies inside rep 1 (s)", set.heroTime - r1.start, 0, r1.end - r1.start);
  }

  // ---- nothing passes through anything
  const cl = M.clearances(s);
  c("bar clear of the skull (gap, m)", cl.barHead, 0, 9);
  c("bar clear of the neck (gap, m)", cl.barNeck, -0.01, 9);
  if (fam === "deadlift") {
    c("bar clear of the thighs (gap, m)", cl.barThigh, -0.01, 9);
    c("bar clear of the shins (gap, m)", cl.barShin, -0.01, 9);
    c("bar clear of the knees (gap, m)", cl.barKnee, 0, 9);
    c("bar clear of the torso (gap, m)", cl.barTorso, 0, 9);
    c("forearms and thighs (gap, m)", cl.forearmThigh, -0.03, 9);
    c("upper arms and thighs (gap, m)", cl.upperThigh, -0.02, 9);
  } else if (fam === "squat") {
    c("forearms and thighs (gap, m)", cl.forearmThigh, -0.02, 9);
    c("upper arms and thighs (gap, m)", cl.upperThigh, 0, 9);
    c("bar in the back: not deeper than the mannequin's back (gap, m)", cl.barTorso, -0.045, 9);
  } else {
    c("forearms and thighs (gap, m)", cl.forearmThigh, 0, 9);
    c("hands and torso (gap, m)", cl.handTorso, 0, 9);
    c("elbows and torso (gap, m)", cl.elbowTorso, 0, 9);
    c("bar on the chest: not deeper than the mannequin's chest (gap, m)", cl.barTorso, -0.04, 9);
  }
  c("feet clear of each other (gap, m)", cl.footFoot, 0, 9);

  // ---- plates against the stage (the 25 kg plate: radius 0.225, its inner face 0.672 from the bar's centre)
  {
    let floorGap = 9, gap = 9;
    const sc = set.scene;
    for (const p of s.poses) {
      floorGap = Math.min(floorGap, p.bar[1] - 0.225);
      if (sc.rack) gap = Math.min(gap, 0.672 - Math.abs(p.bar[2]) - (sc.rack.halfWidth + 0.025));
    }
    c("plates above the floor (gap, m)", floorGap, -1e-9, 9);
    if (sc.rack) c("plates outside the uprights (gap, m)", gap, 0.05, 9);
  }
  return out;
}

export function heavyContinuity(kind: LiftKind, reps: number): Check {
  const set = getSet(kind, reps);
  const s = M.sample(set);
  const j = M.maxJump(s);
  return { id: `${kind}: ${reps} reps: no joint moves more than 1 cm in 1/240 s (cm)`, value: j.cm, lo: 0, hi: 1, note: "" };
}

export { LIFT_KINDS };

/** No joint accelerates like a hit, and the two drawn thighs do not overlap at the hip. */
export function jointSmoothness(kind: LiftKind): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const fam = liftFamily(kind);
  // The elbow near a straight arm and the knee near a straight leg turn a small change of length into a large swing of the joint.
  for (const j of ["elbow", "wrist", "knee"] as const) for (const sd of M.SIDES) {
    const pk = M.peaks(s.poses.map((p) => p[j][sd]), 2, s.poses.length - 3);
    if (sd === "R") c(`${j} acceleration over the whole set (m/s2)`, pk.accel, 0, fam === "bench" && j === "elbow" ? 18 : j === "knee" ? 250 : 100);
  }
  {
    const caps = M.drawnCaps(s.poses[0]).filter((x) => x.name === "thighR" || x.name === "thighL");
    const R = caps.filter((x) => x.name === "thighR"), L = caps.filter((x) => x.name === "thighL");
    let gap = 9;
    for (const a of R) for (const b of L) gap = Math.min(gap, M.capGap(a, b));
    c("thighs do not overlap at the hip (gap between the drawn thigh capsules, m)", gap, -0.0005, 9);
  }
  return out;
}
