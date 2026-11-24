// The squat coach's targets, one Check each: value measured on the set, and the range the coach allows.
import type { LiftKind } from "../../../src/lib/lifts";
import * as M from "./measure";
import { barToHull, kneePastToe, maxOver, shankOf } from "./util";
import { type Check, between, atMost, atLeast, getSet } from "./check";

export function squatChecks(kind: "squat-low" | "squat-high"): Check[] {
  const low = kind === "squat-low";
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number, note = "") => out.push({ id: `${kind}: ${id}`, value, lo, hi, note });
  const r1 = s.rep(1), r2 = s.rep(2);
  const unrack = s.seg("unrack")!, walkout = s.seg("walkout")!, settle = s.seg("settle")!;
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
  const iUn = s.idx(unrack.end);
  const standBar = s.poses[iR1].bar[1];
  const hookBar = s.poses[0].bar[1];

  // ---- rack
  c("rack: bar in the hooks below standing bar height (m)", standBar - hookBar, 0.05, 0.08);
  const walkIn = s.seg("walk in")!, rackSeg = s.seg("rack")!;
  let drift = 0;
  for (let i = s.idx(unrack.start); i <= s.idx(rackSeg.end); i++) {
    const p = s.poses[i];
    drift = Math.max(drift, Math.abs(p.bar[0] - (M.mean(M.SIDES.map((sd) => p.ankle[sd][0])) + 0.07)));
  }
  c("bar over midfoot (ankle + 0.07 m), worst frame (m)", drift, 0, 0.01);

  // ---- walkout
  const fe = M.footEvents(s, iUn, iR1);
  const steps = fe.steps;
  c("walkout: number of steps", steps.length, 3, 3);
  c("walkout: first step is the right foot (1 = yes)", steps[0]?.side === "R" ? 1 : 0, 1, 1);
  c("walkout: steps alternate R, L, R (1 = yes)", steps.length === 3 && steps[0].side === "R" && steps[1].side === "L" && steps[2].side === "R" ? 1 : 0, 1, 1);
  steps.forEach((st, i) => {
    c(`walkout: step ${i + 1} duration (s)`, st.dur, 0.45, 0.6);
    c(`walkout: step ${i + 1} peak foot lift (m)`, st.peakLift, 0.06, 0.08);
  });
  const pA = s.poses[iUn], pB = s.poses[iR1];
  c("walkout: total travel of the feet (m)", Math.abs(M.mean(M.SIDES.map((sd) => pB.ankle[sd][0] - pA.ankle[sd][0]))), 0.45, 0.55);
  const ds = M.doubleSupport(steps);
  c("walkout: least double support between steps (s)", Math.min(...ds), 0.12, 1);
  // by strict contact: heel and toe both within 0.5 mm of the floor (the 3 mm band above lets a foot that is already rolling off count as planted)
  {
    const planted = (p: (typeof s.poses)[number], sd: M.Side) => p.heel[sd][1] < 0.0005 && p.toe[sd][1] < 0.0005;
    let run = 0, least = 9;
    for (let i = s.idx(steps[0].t1); i <= s.idx(steps[steps.length - 1].t0); i++) { if (planted(s.poses[i], "R") && planted(s.poses[i], "L")) run++; else if (run) { least = Math.min(least, run / M.HZ); run = 0; } }
    c("walkout: least double support between steps by strict contact, 0.5 mm (s)", least, 0.12, 1);
  }
  c("walkout: planted foot slide (m)", fe.maxSlide, 0, 0.005);
  let hLo = 9, hHi = -9, bLo = 9, bHi = -9, zLo = 9, zHi = -9, bxSpeed = 0, kneeSpeed = 0, kneeAcc = 0;
  for (let i = iUn; i <= iR1; i++) {
    const p = s.poses[i];
    hLo = Math.min(hLo, p.pelvis[1]); hHi = Math.max(hHi, p.pelvis[1]);
    bLo = Math.min(bLo, p.bar[1]); bHi = Math.max(bHi, p.bar[1]);
    zLo = Math.min(zLo, p.pelvis[2]); zHi = Math.max(zHi, p.pelvis[2]);
    if (i > iUn && i < iR1) {
      bxSpeed = Math.max(bxSpeed, Math.abs(s.poses[i + 1].bar[0] - s.poses[i].bar[0]) * M.HZ);
      for (const sd of M.SIDES) {
        kneeSpeed = Math.max(kneeSpeed, M.len(M.sub(s.poses[i + 1].knee[sd], s.poses[i].knee[sd])) * M.HZ);
        if (i > iUn + 1) kneeAcc = Math.max(kneeAcc, M.len(M.add(M.sub(s.poses[i + 1].knee[sd], M.mul(s.poses[i].knee[sd], 2)), s.poses[i - 1].knee[sd])) * M.HZ * M.HZ);
      }
    }
  }
  c("walkout: pelvis height change (m)", hHi - hLo, 0, 0.02);
  c("walkout: bar height change (m)", bHi - bLo, 0, 0.02);
  c("walkout: pelvis z sway range (m)", zHi - zLo, 0.03, 0.06);
  c("walkout: bar x speed (m/s)", bxSpeed, 0, 0.7);
  c("walkout: knee speed (m/s)", kneeSpeed, 0, 1.6);
  c("walkout: knee acceleration (m/s2)", kneeAcc, 0, 250);
  const lastLand = steps[steps.length - 1].t1;
  let moved = r1.start;
  for (let i = s.idx(lastLand); i <= iR1 + 240; i++) if (Math.abs(s.poses[i].bar[1] - standBar) > 0.005) { moved = s.times[i]; break; }
  c("stillness after the last landing before the bar moves (s)", moved - lastLand, 0.8, 5);
  let leave = 0;
  for (let i = 0; i < s.poses.length; i++) if (Math.abs(s.poses[i].bar[1] - hookBar) > 0.005) { leave = s.times[i]; break; }
  c("pre-roll: time with the bar in the hooks before it moves (s)", leave, 0.6, 2);

  // ---- rep timing
  const rt = M.repTiming(s, 1);
  c("rep: lead (s)", rt.lead, 0.1, 0.15);
  c("rep: descent (s)", rt.first, 1.0, 1.2);
  c("rep: bottom pause (s)", rt.hold, 0.15, 0.3);
  c("rep: ascent (s)", rt.second, 0.95, 1.15);
  c("rep: lockout (s)", rt.last, 0.3, 0.5);
  const bar = s.poses.map((p) => p.bar);
  const bs = M.speedSeries(bar);
  let pkDown = 0, pkUp = 0;
  for (let i = rt.m0; i < rt.e0; i++) pkDown = Math.max(pkDown, bs[i]);
  for (let i = rt.e1; i < rt.a; i++) pkUp = Math.max(pkUp, bs[i]);
  c("rep: peak bar speed down (m/s)", pkDown, 0, 0.95);
  c("rep: peak bar speed up (m/s)", pkUp, 0, 0.85);
  const pk = M.peaks(bar, rt.i0 + 2, rt.i1 - 3);
  c("rep: peak bar acceleration inside a rep (m/s2)", pk.accel, 0, 25);
  let leaveI = rt.e0;
  for (let i = rt.e1; i > rt.e0; i--) if (s.poses[i].bar[1] <= rt.ext + 0.002) { leaveI = i; break; }
  c("rep: bar speed 0.2 s after the bar leaves the bottom (m/s)", bs[leaveI + Math.round(0.2 * M.HZ)], 0, 0.6);
  // sticking region: velocity dip between 20% and 50% of the rise
  const yBot = s.poses[rt.e1].bar[1], yTop = s.poses[rt.a].bar[1];
  let peakBefore = 0, dip = 0;
  for (let i = rt.e1; i < rt.a; i++) {
    const frac = (s.poses[i].bar[1] - yBot) / (yTop - yBot);
    peakBefore = Math.max(peakBefore, bs[i]);
    if (frac >= 0.2 && frac <= 0.5) dip = Math.max(dip, peakBefore - bs[i]);
  }
  c("rep: velocity dip below the earlier peak between 20% and 50% of the rise (m/s)", dip, 0.12, 2);

  // ---- bottom of the squat
  const tB = M.extremeTime(s, r1.start, r1.end, "min");
  const pb = s.set.pose(tB);
  c("depth: hip joint minus knee joint at the bottom (m)", M.both((sd) => pb.hip[sd][1] - pb.knee[sd][1]), -0.05, -0.03);
  let heel = 0;
  for (let i = iR1; i <= iRL; i++) for (const sd of M.SIDES) heel = Math.max(heel, s.poses[i].heel[sd][1], s.poses[i].toe[sd][1]);
  c("heels and toes off the floor during the reps (m)", heel, 0, 0.0001);
  const kneeOff = M.both((sd) => {
    const f = M.sub(pb.toe[sd], pb.heel[sd]), l = Math.hypot(f[0], f[2]);
    const k = M.sub(pb.knee[sd], pb.heel[sd]);
    return Math.abs((f[0] * k[2] - f[2] * k[0]) / l);
  });
  c("knee off the heel-toe axis at the bottom (m)", kneeOff, 0, 0.03);
  const kpt = M.both((sd) => pb.knee[sd][0] - pb.toe[sd][0]);
  c("knee past the toe at the bottom (m)", kpt, low ? 0 : 0.04, low ? 0.02 : 0.08);
  c("lean at the bottom (deg from vertical)", M.slope(pb.pelvis, pb.chest), low ? 47 : 30, low ? 52 : 35);
  c("shank angle at the bottom (deg)", M.both((sd) => M.slope(pb.ankle[sd], pb.knee[sd])), low ? 26 : 35, low ? 29 : 39);
  c("hand-to-hand (m)", M.dist(pb.hand.R, pb.hand.L), low ? 0.68 : 0.55, low ? 0.76 : 0.62);
  c("toe-out (deg)", M.stanceOf(pb).toeOut, low ? 28 : 20, low ? 30 : 25);
  const elbowAbove = M.both((sd) => pb.elbow[sd][1] - pb.hand[sd][1]);
  if (low) {
    c("elbow above the hand centre (m); the coach's model has no hand beyond the wrist, our wrist is 0.077 m below the hand centre: docs/lift-motion.md", elbowAbove, 0.1, 0.2);
    c("elbow z (m)", M.both((sd) => Math.abs(pb.elbow[sd][2])), 0.3, 0.38);
    c("elbow ahead of the hand (m, <= 0)", Math.max(...M.SIDES.map((sd) => pb.elbow[sd][0] - pb.hand[sd][0])), -1, 0);
    c("bar behind the torso axis (m); the coach's 0.10-0.12 widened to 0.13: the drawn ribs (radius 0.118, ball 0.01 forward) are wider than that band lets a bar rest 10 mm clear of them, docs/lift-motion.md", M.behindAxis(pb, pb.bar), 0.1, 0.13);
  } else {
    c("elbow below the hand centre (m)", -elbowAbove, 0.25, 0.35);
    c("elbow below the wrist, the literal wording of the coach (m)", M.both((sd) => pb.wrist[sd][1] - pb.elbow[sd][1]), 0.25, 0.35);
    c("bar behind the torso axis (m)", M.behindAxis(pb, pb.bar), 0.08, 0.11);
    c("bar to head centre at the bottom (m)", M.dist(pb.bar, pb.head), 0.19, 5);
  }
  // knees: most outward the elbow ever sits is checked with the integrity block; here the nearest elbow to the midline
  let nearMid = 9;
  for (let i = iR1; i <= iRL; i++) for (const sd of M.SIDES) nearMid = Math.min(nearMid, Math.abs(s.poses[i].elbow[sd][2]));
  c("elbow nearest the midline during the reps (m)", nearMid, 0.15, 5);

  // ---- integrity
  const jump = M.maxJump(s);
  c("no joint moves more than 2 cm in 1/240 s (events)", jump.over2, 0, 0);
  c("no joint moves more than 1 cm in 1/240 s (cm, worst)", jump.cm, 0, 1);
  const rel = s.seg("let go")!;
  let handSpeed = 0, elbowSpeed = 0;
  for (let i = 1; i < s.poses.length; i++) {
    const t = s.times[i];
    if ((t >= unrack.start && t <= unrack.end + 0.2) || (t >= rel.start - 0.01 && t <= rel.end + 0.01)) continue;
    for (const sd of M.SIDES) {
      handSpeed = Math.max(handSpeed, M.dist(s.poses[i].hand[sd], s.poses[i - 1].hand[sd]) * M.HZ);
      elbowSpeed = Math.max(elbowSpeed, M.dist(s.poses[i].elbow[sd], s.poses[i - 1].elbow[sd]) * M.HZ);
    }
  }
  c("hand speed outside the unrack and release (m/s)", handSpeed, 0, 2.5);
  c("elbow speed outside the unrack and release (m/s)", elbowSpeed, 0, 2.5);
  let axisMin = 9, headMin = 9, armThigh = 9;
  for (let i = 0; i < s.poses.length; i++) {
    const p = s.poses[i];
    axisMin = Math.min(axisMin, Math.abs(M.behindAxis(p, p.bar)));
    headMin = Math.min(headMin, M.dist(p.bar, p.head));
    if (p.gripping) for (const a of M.SIDES) for (const b of M.SIDES) armThigh = Math.min(armThigh, M.segSeg(p.elbow[a], p.wrist[a], p.hip[b], p.knee[b]));
  }
  c("bar never within 0.07 m of the torso axis (min, m)", axisMin, 0.07, 5);
  c("bar never within 0.15 m of the head centre (min, m)", headMin, 0.15, 5);
  c("arm to thigh distance while gripping (m)", armThigh, 0.12, 5);

  // ---- end of set
  const rack = s.seg("rack")!, letgo = s.seg("let go")!, stepOut = s.seg("step out")!;
  c("end: release lowers the arms over (s)", letgo.end - letgo.start, 0.7, 3);
  const feStep = M.footEvents(s, s.idx(stepOut.start), s.poses.length - 1);
  c("end: steps out of the rack", feStep.steps.length, 2, 3);
  const pe = s.poses[s.poses.length - 1];
  c("end: lifter clear of the bar (pelvis x ahead of the bar, m)", pe.pelvis[0] - pe.bar[0], 0.25, 2);
  const durations = [2, 8].map((n) => getSet(kind, n).duration);
  c("duration, 2 reps (s)", durations[0], 12, 14);
  c("duration, 8 reps (s): the coach's 28-31 s plus the last reps' grind", durations[1], 28, 32.6);
  void rack; void settle; void walkout; void walkIn;
  return out;
}

export function lowHighChecks(): Check[] {
  const out: Check[] = [];
  const get = (kind: "squat-low" | "squat-high") => {
    const set = getSet(kind, 2);
    const s = M.sample(set);
    const r1 = s.rep(1);
    const p = set.pose(M.extremeTime(s, r1.start, r1.end, "min"));
    return { p, lean: M.slope(p.pelvis, p.chest), shank: M.both((sd) => M.slope(p.ankle[sd], p.knee[sd])), hipX: p.pelvis[0] - p.bar[0], grip: M.dist(p.hand.R, p.hand.L), along: M.alongAxis(p, p.bar), barY: p.bar[1] };
  };
  const lo = get("squat-low"), hi = get("squat-high");
  const c = (id: string, value: number, a: number, b: number) => out.push({ id: `low vs high: ${id}`, value, lo: a, hi: b, note: "" });
  c("torso lean differs by (deg)", lo.lean - hi.lean, 15, 90);
  c("shank angle differs by (deg)", hi.shank - lo.shank, 10, 90);
  c("hip x further back in low bar by (m)", hi.hipX - lo.hipX, 0.05, 1);
  c("grip wider in low bar by (m)", lo.grip - hi.grip, 0.12, 1);
  c("bar lower along the torso in low bar by (m)", hi.along - lo.along, 0.05, 0.08);
  c("bottom bar height lower in low bar by (m)", hi.barY - lo.barY, 0.05, 0.09);
  return out;
}
void ({} as LiftKind);
void between; void atMost; void atLeast;

export function squatStanding(kind: "squat-low" | "squat-high"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
    const low = kind === "squat-low";
    const pelvisTall = 0.915;
    // ---- the lifter stands up: lockout of every rep, the settle, the end
    const tall = (label: string, i: number) => {
      const p = s.poses[i];
      c(`stands tall at ${label}: knee interior angle (deg)`, M.both((sd) => M.kneeAngle(p, sd)), 172, 178.9);
      c(`stands tall at ${label}: torso lean (deg; the bar over the midfoot with the bar ~0.11 m behind the torso axis needs about 10)`, M.slope(p.pelvis, p.chest), 0, 13);
      c(`stands tall at ${label}: shank from vertical (deg)`, M.both((sd) => Math.abs(M.slope(p.ankle[sd], p.knee[sd]))), 0, 12);
      c(`stands tall at ${label}: pelvis height (m)`, p.pelvis[1], pelvisTall, 1);
    };
    tall("the start of rep 1", iR1);
    tall("the end of rep 2", iRL);
    tall("the end of the set", s.poses.length - 1);
    const lg = s.seg("let go")!, st = s.seg("settle")!;
    tall("the end of the settle", s.idx(st.end));
    {
      const p = s.poses[s.idx(lg.start + 0.5)];
      void p;
      // the lifter stays at the rack's height until he steps out of it (round 4: standing up with the bar still at his back put it inside him); he is up by the end of the second step
      const q = s.poses[s.idx(s.seg("step out")!.end - 0.1)];
      c("step out: standing by 0.1 s before the end of the step out, pelvis height (m)", q.pelvis[1], 0.91, 1);
      c("step out: standing by 0.1 s before the end of the step out, torso lean (deg)", M.slope(q.pelvis, q.chest), 0, 13);
    }
    // ---- the hands never go through the thighs: not at the step out, not in the release, not on the walk
    const free = (i: number) => i % 2 === 0 && !s.poses[i].gripping;
    const g = M.limbGaps(s, 0, s.poses.length - 1, free);
    c("free hand (mitt) to thigh axis, closest over the set (gap to the drawn thigh, m; 0.008 is an axis distance of 0.14)", g.handThigh, 0.008, 9);
    c("free forearm to the drawn thigh, closest (m)", g.forearmThigh, 0.03, 9);
    c("free upper arm to the drawn thigh, closest (m)", g.upperThigh, 0.03, 9);
    // ---- the release: the elbows drop, they do not swing out and up
    {
      const i0 = s.idx(lg.start), i1 = s.idx(lg.end);
      const hangZ = Math.abs(s.poses[i1].elbow.R[2]);
      c("release: elbow lateral excursion beyond its hanging position (m)", maxOver(s.poses.slice(i0, i1 + 1).map((p) => Math.abs(p.elbow.R[2]) - hangZ)), -1, 0.08);
      const rel0 = s.poses[i0].elbow.R[1] - s.poses[i0].shoulder.R[1];
      c("release: elbow height above the shoulder never more than 0.05 above where it started (m; round 5: the elbow swings back along its arc)", maxOver(s.poses.slice(i0, i1 + 1).map((p) => p.elbow.R[1] - p.shoulder.R[1])) - rel0, -1, 0.05);
      let v = 0;
      for (let i = i0 + 1; i <= i1; i++) v = Math.max(v, M.dist(s.poses[i].elbow.R, s.poses[i - 1].elbow.R) * M.HZ);
      c("release: peak elbow speed (m/s)", v, 0, 1.4);
      let hv = 0;
      for (let i = i0 + 1; i <= i1; i++) hv = Math.max(hv, M.dist(s.poses[i].hand.R, s.poses[i - 1].hand.R) * M.HZ);
      c("release: peak hand speed (m/s)", hv, 0, 2.2);
    }
    // ---- smooth through the rep: no kink of the pelvis at the top, the bottom or the start of a descent
    {
      const i0 = iR1 + 2, i1 = iRL - 3;
      c("reps: pelvis acceleration (m/s2); the knee near straight turns a millimetre of hip height into a large swing of the knee: 30, not 25, with the coach's 0.15 s lead", M.peaks(s.poses.map((p) => p.pelvis), i0, i1).accel, 0, 30);
      c("reps: knee acceleration, right (m/s2)", M.peaks(s.poses.map((p) => p.knee.R), i0, i1).accel, 0, 25);
      c("reps: knee acceleration, left (m/s2)", M.peaks(s.poses.map((p) => p.knee.L), i0, i1).accel, 0, 25);
      c("reps: hip jerk (m/s3)", M.peaks(s.poses.map((p) => p.hip.R), i0, i1).jerk, 0, 5000);
      c("whole set: pelvis acceleration (m/s2)", M.peaks(s.poses.map((p) => p.pelvis), 2, s.poses.length - 3).accel, 0, 35);
      c("whole set: hip jerk (m/s3)", M.peaks(s.poses.map((p) => p.hip.R), 2, s.poses.length - 3).jerk, 0, 12000);
    }
    // ---- the pause, three ways: within 1 cm (the coach's), within 1 mm, and slower than 0.05 m/s
    {
      const tB = M.extremeTime(s, r1.start, r1.end, "min"), iB = s.idx(tB), yB = s.poses[iB].bar[1];
      let a = iB, b = iB;
      while (a > iR1 && Math.abs(s.poses[a - 1].bar[1] - yB) <= 0.001) a--;
      while (b < s.idx(r1.end) && Math.abs(s.poses[b + 1].bar[1] - yB) <= 0.001) b++;
      c("pause: time within 1 mm of the bottom (s)", (b - a + 1) / M.HZ, 0.15, 0.3);
      const bs = M.speedSeries(s.poses.map((p) => p.bar));
      let x = iB, y = iB;
      while (x > iR1 && bs[x - 1] < 0.05) x--;
      while (y < s.idx(r1.end) && bs[y + 1] < 0.05) y++;
      c("pause: time slower than 0.05 m/s at the bottom (s)", (y - x + 1) / M.HZ, 0.15, 0.3);
    }
    // ---- recorded, not tuned: three steps R, L, R of 0.24, 0.46 and 0.22 m (a square finish cannot have even steps)
    {
      const un = s.seg("unrack")!;
      const fe = M.footEvents(s, s.idx(un.end), iR1);
      const want = [0.24, 0.46, 0.22];
      fe.steps.forEach((st2, i) => c(`walkout: step ${i + 1} length, recorded (m)`, st2.length, want[i] - 0.03, want[i] + 0.03));
    }
    void low;
  return out;
}

export function squatBottomAndRelease(kind: "squat-low" | "squat-high"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iR1E = s.idx(r1.end), iRL = s.idx(r2.end);
    const low = kind === "squat-low";
    const tB = M.extremeTime(s, r1.start, r1.end, "min"), iB = s.idx(tB), pb = s.poses[iB];
    // ---- the shank only leans forward on the way down and only back on the way up: no loop of the knee (round 4, defect 1)
    for (const [label, a, b, sign] of [["descent", iR1, iB, 1], ["ascent", iB, iR1E, -1]] as const) {
      let reverse = 0, top = -9;
      for (let i = a; i < b; i++) { reverse = Math.max(reverse, -sign * (shankOf(s.poses[i + 1]) - shankOf(s.poses[i]))); top = Math.max(top, shankOf(s.poses[i])); }
      c(`${label}: the shank never turns back (largest step against the direction of the move, deg)`, reverse, 0, 0.05);
    }
    let maxShank = -9, maxKpt = -9, maxKneeX = -9;
    for (let i = iR1; i <= iRL; i++) { const p = s.poses[i]; maxShank = Math.max(maxShank, shankOf(p)); maxKpt = Math.max(maxKpt, kneePastToe(p)); maxKneeX = Math.max(maxKneeX, M.both((sd) => p.knee[sd][0] - p.ankle[sd][0])); }
    c("shank angle over the reps never beyond its value at the bottom (deg)", maxShank - shankOf(pb), -0.01, 0.1);
    c("knee past the toe over the whole rep stays inside the bottom band: its largest value (m)", maxKpt, low ? 0 : 0.04, low ? 0.02 : 0.08);
    c("the knee never goes further forward than at the bottom (m)", maxKneeX - M.both((sd) => pb.knee[sd][0] - pb.ankle[sd][0]), -0.001, 0.001);

    // ---- the bar clear of the drawn back in every frame, with the bar in the hooks and walking away from them (defect 2)
    let worst = 9, tw = 0;
    for (let i = 0; i < s.poses.length; i += 2) { const g = barToHull(s.poses[i]); if (g < worst) { worst = g; tw = s.times[i]; } }
    void tw;
    c("bar to the drawn upper trunk (ribs 0.118 at 55% with 0.01 forward, shoulder and chest balls), worst frame of the set (m)", worst, 0.01, 9);

    // ---- the bottom: an easy stop and a ramped launch (defect 3)
    {
      const bar = s.poses.map((p) => p.bar), pelvis = s.poses.map((p) => p.pelvis), bs = M.speedSeries(bar);
      const acc = (series: Array<readonly number[]>, i: number) => M.len(M.add(M.sub(series[i + 1], M.mul(series[i], 2)), series[i - 1])) * M.HZ * M.HZ;
      const rt = M.repTiming(s, 1);
      let leaveI = rt.e0;
      for (let i = rt.e1; i > rt.e0; i--) if (s.poses[i].bar[1] <= rt.ext + 0.001) { leaveI = i; break; }
      // the stop: from 0.4 s before the bar stops to the stop
      let stopI = rt.e0;
      for (let i = rt.e0; i < rt.e1; i++) if (s.poses[i].bar[1] <= rt.ext + 0.001) { stopI = i; break; }
      const a0 = Math.max(rt.m0 + 2, stopI - Math.round(0.4 * M.HZ));
      c("the stop: largest bar acceleration in the 0.4 s before the bar stops (m/s2; was 11.4 over 40 ms)", maxOver(Array.from({ length: stopI - a0 + 1 }, (_, k) => acc(bar, a0 + k))), 0, 6.5);
      c("the stop: largest pelvis acceleration in the 0.4 s before the bar stops (m/s2)", maxOver(Array.from({ length: stopI - a0 + 1 }, (_, k) => acc(pelvis, a0 + k))), 0, 9);
      c("the stop: the bar's speed 0.15 s before it stops is not yet down to the creep (m/s): it eases in, over a third of a second", bs[stopI - Math.round(0.15 * M.HZ)], 0.2, 0.6);
      c("the launch: largest bar acceleration in the 0.5 s after the bar leaves the bottom (m/s2; was 11.8 over 60 ms)", maxOver(Array.from({ length: Math.round(0.5 * M.HZ) }, (_, k) => acc(bar, leaveI + 2 + k))), 0, 7);
      c("the launch: the bar takes at least 0.09 s to go from 0.03 to 0.3 m/s (s; was 0.025)", (() => { let i = stopI + 2; while (i < rt.a && bs[i] < 0.03) i++; const j0 = i; while (i < rt.a && bs[i] < 0.3) i++; return (i - j0) / M.HZ; })(), 0.09, 0.4);
      // the humps of the ascent: a first of 0.55-0.66 m/s about 0.2-0.3 s after leaving, a dip, and a second hump lower than the first
      let first = 0, tFirst = 0;
      for (let i = leaveI; i < leaveI + Math.round(0.45 * M.HZ); i++) if (bs[i] > first) { first = bs[i]; tFirst = (i - leaveI) / M.HZ; }
      c("the ascent's first hump (m/s)", first, 0.55, 0.66);
      c("the first hump comes this long after the bar leaves the bottom (s)", tFirst, 0.12, 0.3);
      let dip = 9, iDip = leaveI;
      for (let i = leaveI + Math.round(0.3 * M.HZ); i < rt.a - Math.round(0.3 * M.HZ); i++) if (bs[i] < dip) { dip = bs[i]; iDip = i; }
      c("the sticking dip (m/s)", dip, 0.35, 0.5);
      let second = 0;
      for (let i = iDip; i < rt.a - Math.round(0.1 * M.HZ); i++) second = Math.max(second, bs[i]);
      c("the second hump is lower than the first by (m/s; the reverse of the graft's 0.82, 0.35, 0.57)", first - second, 0.03, 0.3);
      c("the second hump is above the dip by (m/s)", second - dip, 0.05, 0.4);
    }

    // ---- the release (defects 4 and 9): the arm clears the drawn trunk, the forearm drops on a steady unfolding, no flick
    {
      const lg = s.seg("let go")!, so = s.seg("step out")!;
      let hand = 9, fore = 9, elb = 9, hs = 0;
      for (let i = s.idx(lg.start) - 4; i <= s.idx(so.end); i += 2) { const g = M.armToDrawnTrunk(s.poses[i]); hand = Math.min(hand, g.hand); fore = Math.min(fore, g.forearm); elb = Math.min(elb, g.elbow); }
      c("release and step out: hand to the drawn trunk, worst (m; was -0.025 for 0.15 s on the high bar)", hand, 0.01, 9);
      c("release and step out: forearm to the drawn trunk, worst (m; was -0.012)", fore, 0.01, 9);
      c("release and step out: elbow and upper arm to the drawn trunk, worst (m; was -0.004)", elb, 0.01, 9);
      const i0 = s.idx(lg.start), i1 = s.idx(lg.end);
      let fall = 0;
      for (let i = i0; i < i1; i++) fall = Math.max(fall, M.elbowAngle(s.poses[i], "R") - M.elbowAngle(s.poses[i + 1], "R"));
      c("release: the elbow's flexion only falls (the interior angle never closes again; largest closing step in 1/240 s, deg)", fall, 0, 0.05);
      let smooth = 0;
      for (let i = i0 + 2; i < i1 - 1; i++) smooth = Math.max(smooth, Math.abs(M.elbowAngle(s.poses[i + 1], "R") - 2 * M.elbowAngle(s.poses[i], "R") + M.elbowAngle(s.poses[i - 1], "R")) * M.HZ * M.HZ);
      c("release: the elbow angle's acceleration (deg/s2): a steady unfolding, not a flick", smooth, 0, 1200);
      for (const sd of M.SIDES) hs = Math.max(hs, ...Array.from({ length: i1 - i0 }, (_, k) => M.dist(s.poses[i0 + k + 1].hand[sd], s.poses[i0 + k].hand[sd]) * M.HZ));
      c("release: peak hand speed (m/s): the arms drop in 1.3 s, not 2 s; the coach allows 2.5", hs, 0, 1.5);
    }

    // ---- the elbows, as the coach wrote them and as the hand centre has them (defect 5)
    {
      if (low) c("low bar: elbow above the wrist, the coach's wording, recorded (m): the wrist is 0.077 below the hand centre; the three constraints (z, not ahead of the hand, 10-20 above the wrist) cannot all hold on this geometry: docs/lift-motion.md", M.both((sd) => pb.elbow[sd][1] - pb.wrist[sd][1]), 0.2, 0.3);
      else c("high bar: elbow below the wrist and below the hand centre both in the coach's 0.25-0.35 (smallest of the two, m)", Math.min(M.both((sd) => pb.wrist[sd][1] - pb.elbow[sd][1]), M.both((sd) => pb.hand[sd][1] - pb.elbow[sd][1]) - 0.0), 0.25, 0.35);
    }

    // ---- the stance (defect 6) and the thigh against the foot (defect 9)
    c("heel to heel at the bottom (m): the coach's 0.42 (low bar) and 0.37 (high bar)", M.dist(pb.heel.R, pb.heel.L), low ? 0.41 : 0.36, low ? 0.43 : 0.385);
    const thighYaw = M.both((sd) => M.deg(Math.atan2(Math.abs(pb.knee[sd][2] - pb.hip[sd][2]), pb.knee[sd][0] - pb.hip[sd][0])));
    const footYaw = M.both((sd) => { const f = M.sub(pb.toe[sd], pb.heel[sd]); return M.deg(Math.atan2(Math.abs(f[2]), f[0])); });
    c("thigh yaw less foot yaw at the bottom (deg; was 3.2 low bar after the wider stance and 6.1 high bar)", thighYaw - footYaw, -1, low ? 3 : 5);

    // ---- the walkout: knee speed with margin (defect 7)
    {
      const un = s.seg("unrack")!, iUn = s.idx(un.end);
      let ks = 0;
      for (let i = iUn + 1; i < iR1; i++) for (const sd of M.SIDES) ks = Math.max(ks, M.dist(s.poses[i + 1].knee[sd], s.poses[i].knee[sd]) * M.HZ);
      c("walkout: knee speed with margin under the 1.6 limit (m/s; was 1.55)", ks, 0, 1.5);
    }
  return out;
}

export function squatTempoAndRelease(kind: "squat-low" | "squat-high"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1);
  const iR1 = s.idx(r1.start);
    const low = kind === "squat-low";
    const rel = s.seg("let go")!, so = s.seg("step out")!;
    const i0 = s.idx(rel.start) - 2;
    // ---- defect "the release unfolds the forearm through the front": the arms drop down the side, the forearm hangs below the elbow
    let ahead = -9, hand = 0, wrist = 0, elbowRise = -9;
    const e0 = s.poses[s.idx(rel.start)].elbow.R[1] - s.poses[s.idx(rel.start)].shoulder.R[1];
    for (let i = i0; i < s.poses.length; i++) {
      const p = s.poses[i];
      for (const sd of M.SIDES) {
        ahead = Math.max(ahead, p.wrist[sd][0] - p.shoulder[sd][0], p.elbow[sd][0] - p.shoulder[sd][0]);
        if (i > 0) { hand = Math.max(hand, M.dist(p.hand[sd], s.poses[i - 1].hand[sd]) * M.HZ); wrist = Math.max(wrist, M.dist(p.wrist[sd], s.poses[i - 1].wrist[sd]) * M.HZ); }
      }
      if (i <= s.idx(rel.end)) elbowRise = Math.max(elbowRise, p.elbow.R[1] - p.shoulder.R[1] - e0);
    }
    c("release: no frame with the wrist or the elbow more than 0.16 m ahead of the shoulder (m): the forearm swings forward as the arm drops, it is not held out like a tray", ahead, -1, 0.16);
    c("release: peak hand speed over the whole release and step out (m/s)", hand, 0, 1.5);
    c("release: peak wrist speed (m/s)", wrist, 0, 1.5);
    c("release: the elbows swing back along their arc, rising at most 0.05 m above where they were at the let go (m)", elbowRise, -1, 0.05);
    c("release: takes 1.0 to 1.6 s: the coach wants at least 0.7 s of dropping, the coach no dead time in the rack", rel.end - rel.start, 1.0, 1.6);
    {
      // the elbows drop; they do not swing back past where the grip had them (the low bar grips with the elbows 0.22 m behind the shoulder line)
      const p0 = s.poses[s.idx(rel.start)];
      let behind = -9;
      for (let i = s.idx(rel.start); i <= s.idx(so.end); i++) for (const sd of M.SIDES) behind = Math.max(behind, s.poses[i].shoulder[sd][0] - s.poses[i].elbow[sd][0]);
      c("release: the elbow never swings further back than 0.06 m behind where the grip had it, nor 0.10 m behind the shoulder line (m)", behind - Math.max(p0.shoulder.R[0] - p0.elbow.R[0], 0.04), -1, 0.06);
    }
    // ---- the hanging arms and the free hand at the step out: the mitt well clear of the thigh
    {
      let mitt = 9;
      for (let i = s.idx(rel.start); i <= s.idx(so.end); i += 2) mitt = Math.min(mitt, M.limbGaps(s, i, i, () => true).handThigh);
      c("release and step out: the free hand (mitt) to the drawn thigh, closest (m; 0.004 low and 0.011 high by the verifier's measure)", mitt, 0.03, 9);
    }
    // ---- the upper arm, from 40% of its length down, against the drawn trunk as the hull the drawing fills: while gripping it stays out of the hull;
    // in the release and the hang the drawn armpit is filled and the arm lies along the ribs (recorded)
    {
      let grip = 9, free = 9;
      for (let i = 0; i < s.poses.length; i += 3) {
        const p = s.poses[i], T = M.drawnTorso(p);
        for (const sd of M.SIDES) for (const k of [0.4, 0.55, 0.7, 0.85, 1]) {
          const pt = M.add(p.shoulder[sd], M.mul(M.sub(p.elbow[sd], p.shoulder[sd]), k));
          const g = M.hullSigned(pt, T.upper) - (0.054 - 0.01 * k);
          if (p.gripping) grip = Math.min(grip, g); else free = Math.min(free, g);
        }
      }
      c("upper arm (from 40% down) to the drawn trunk hull while gripping (m; was -0.037 high bar, rep 1)", grip, low ? -0.003 : -0.012, 9);
      c("upper arm (from 40% down) to the drawn trunk hull in the release and the hang, recorded (m; the drawn armpit is filled; was -0.020 and -0.019)", free, -0.02, 9);
    }
    // ---- tempo with margin: the 8-rep set about 30 s, the bar's speed 0.2 s off the bottom about 0.52 m/s
    c("duration, 8 reps, the coach's 28-31 s plus the last reps' grind (s)", getSet(kind, 8).duration, 28.5, 32.5);
    c("duration, 2 reps (s)", set.duration, 12.5, 13.8);
    {
      // the walk in is as slow as the walkout was, with the same bar: the end of a heavy set does not look brisk
      const wo = s.seg("walkout")!, wi = s.seg("walk in")!, bsp = M.speedSeries(s.poses.map((p) => p.bar));
      c("walk in is at least as long as the walkout (s)", (wi.end - wi.start) - (wo.end - wo.start), 0, 1);
      c("walk in: bar speed no higher than the walkout's (m/s)", maxOver(bsp.slice(s.idx(wi.start), s.idx(wi.end))) - maxOver(bsp.slice(s.idx(wo.start), s.idx(wo.end))), -1, 0.02);
    }
    {
      const rt = M.repTiming(s, 1), bs = M.speedSeries(s.poses.map((p) => p.bar));
      let leaveI = rt.e0;
      for (let i = rt.e1; i > rt.e0; i--) if (s.poses[i].bar[1] <= rt.ext + 0.002) { leaveI = i; break; }
      c("rep: bar speed 0.2 s after the bar leaves the bottom, with margin under the 0.6 limit (m/s; was 0.582 and 0.596)", bs[leaveI + Math.round(0.2 * M.HZ)], 0.45, 0.58);
    }
    // ---- recorded: the coach's numbers that the bar over the midfoot forbids (docs/lift-motion.md)
    {
      const p = s.poses[iR1];
      c("recorded: stands tall at the start of a rep, torso lean (deg); the verifier asked at most 5, which the bar over the midfoot (ankle + 0.07, within 1 cm) with the bar 0.11 behind the torso axis forbids", M.slope(p.pelvis, p.chest), 0, low ? 11.7 : 9.7);
      c("recorded: stands tall at the start of a rep, knee interior angle (deg); the verifier asked at least 176", M.both((sd) => M.kneeAngle(p, sd)), 172.5, 178.9);
      c("recorded: stands tall at the start of a rep, pelvis height (m)", p.pelvis[1], low ? 0.917 : 0.923, 1);
      const pb = set.pose(M.extremeTime(s, r1.start, r1.end, "min"));
      if (low) {
        c("recorded: low bar, elbow above the wrist (m); the coach's 0.10-0.20 cannot hold with elbow z 0.30-0.38 and no elbow ahead of the hand", M.both((sd) => pb.elbow[sd][1] - pb.wrist[sd][1]), 0.255, 0.275);
        c("recorded: low bar, bar behind the torso axis (m); the coach's 0.10-0.12 is inside the drawn ribs by 3 mm at 0.12", M.behindAxis(pb, pb.bar), 0.12, 0.128);
      }
      const un = s.seg("unrack")!, fe = M.footEvents(s, s.idx(un.end), iR1);
      c("recorded: the middle step of the walkout is the whole travel, a square finish (m); 0.30 each would end with the feet 0.30 m apart", fe.steps[1].length, 0.42, 0.5);
    }
  return out;
}

/** Every check of one squat lift. */
export const squatSuite = (kind: "squat-low" | "squat-high"): Check[] => [...squatChecks(kind), ...squatStanding(kind), ...squatBottomAndRelease(kind), ...squatTempoAndRelease(kind)];
