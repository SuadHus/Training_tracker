// The reference targets for the deadlift, one Check each.
import * as M from "./measure";
import { maxOver, minOver } from "./util";
import { type Check, getSet } from "./check";
import type { LiftPose } from "../../../src/lib/lift-pose";

const back = (p: LiftPose) => M.deg(Math.atan2(p.chest[1] - p.pelvis[1], Math.abs(p.chest[0] - p.pelvis[0])));

type DeadStart = { p: LiftPose; t: number; back: number; hip: number; knee: number; shin: number; shoulderAhead: number; heels: number; toeOut: number; hands: number; handMinusKnee: number };
function deadStart(kind: "deadlift-conventional" | "deadlift-sumo"): DeadStart {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const t = M.leaveFloorTime(s)!;
  const p = set.pose(t);
  const st = M.stanceOf(p);
  return {
    p, t, back: back(p), hip: p.pelvis[1], knee: M.both((sd) => M.kneeAngle(p, sd)), shin: M.both((sd) => M.slope(p.ankle[sd], p.knee[sd])),
    shoulderAhead: p.chest[0] - p.bar[0], heels: st.heelToHeel, toeOut: st.toeOut, hands: M.dist(p.hand.R, p.hand.L),
    handMinusKnee: M.both((sd) => Math.abs(p.hand[sd][2]) - Math.abs(p.knee[sd][2])),
  };
}

function deadChecks(kind: "deadlift-conventional" | "deadlift-sumo"): Check[] {
  const sumo = kind === "deadlift-sumo";
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
  const d = deadStart(kind);
  const p = d.p;

  // ---- start
  c("start: back angle above horizontal at lift-off (deg)", d.back, sumo ? 56 : 30, sumo ? 64 : 36);
  c("start: hip height (m)", d.hip, sumo ? 0.44 : 0.58, sumo ? 0.49 : 0.64);
  c("start: knee angle (deg)", d.knee, sumo ? 75 : 88, sumo ? 82 : 96);
  c("start: shoulders ahead of the bar (m)", d.shoulderAhead, 0.015, sumo ? 0.05 : 0.045);
  c("start: arms from vertical (deg)", Math.max(...M.SIDES.map((sd) => Math.abs(M.deg(Math.atan2(p.shoulder[sd][0] - p.hand[sd][0], p.shoulder[sd][1] - p.hand[sd][1]))))), 0, 4);
  c("start: elbow interior angle (deg)", M.both((sd) => M.elbowAngle(p, sd)), 172, 179);
  c("start: heel-to-heel (m)", d.heels, sumo ? 0.78 : 0.22, sumo ? 0.9 : 0.28);
  c("start: toe-out (deg)", d.toeOut, sumo ? 40 : 0, sumo ? 48 : 12);
  c("start: hand-to-hand (m)", d.hands, sumo ? 0.38 : 0.48, sumo ? 0.42 : 0.54);
  if (sumo) {
    c("start: ankle-to-ankle (m)", M.dist(p.ankle.R, p.ankle.L), 0.86, 0.96);
    c("start: hip no lower than 6 cm below the knee (m)", p.pelvis[1] - M.both((sd) => p.knee[sd][1]), -0.06, 1);
    c("start: shin from vertical, knee ahead of the ankle (deg)", d.shin, 0, 8);
    c("start: knee not inside the ankle (|knee z| - |ankle z|, m)", M.both((sd) => Math.abs(p.knee[sd][2]) - Math.abs(p.ankle[sd][2])), 0, 1);
    const off = M.both((sd) => { const f = M.sub(p.toe[sd], p.heel[sd]), l = Math.hypot(f[0], f[2]); const k = M.sub(p.knee[sd], p.heel[sd]); return ((f[0] * k[2] - f[2] * k[0]) / l) * (sd === "R" ? 1 : -1); });
    c("start: knee lateral offset from the toe line (m, outside is +)", off, -0.1, 0.0);
    c("start: hands inside the knees (|knee z| - |hand z|, m)", -d.handMinusKnee, 0.2, 1);
  } else {
    c("start: hands outside the knees (m)", d.handMinusKnee, 0.07, 1);
  }

  // ---- pull
  const iLeave = s.idx(d.t);
  let driftX = 0;
  for (let i = iR1; i <= iRL; i++) driftX = Math.max(driftX, Math.abs(s.poses[i].bar[0]));
  c("bar x drift (m)", driftX, 0, 0.005);
  const tTop = M.extremeTime(s, r1.start, r1.end, "max");
  const pTop = set.pose(tTop);
  // bar at knee height going up and coming down
  let iKneeUp = iLeave, iKneeDn = iLeave;
  const iTop = s.idx(tTop);
  for (let i = iLeave; i <= iTop; i++) { const q = s.poses[i]; if (q.bar[1] >= M.mean(M.SIDES.map((sd) => q.knee[sd][1]))) { iKneeUp = i; break; } }
  for (let i = s.idx(r1.end) - 1; i > iTop; i--) { const q = s.poses[i]; if (q.bar[1] >= M.mean(M.SIDES.map((sd) => q.knee[sd][1]))) { iKneeDn = i; break; } }
  c("pull: back angle rise from lift-off to bar-at-knee (deg)", back(s.poses[iKneeUp]) - d.back, -5, 12);
  c("pull: knee angle at bar-at-knee (deg)", M.both((sd) => M.kneeAngle(s.poses[iKneeUp], sd)), sumo ? 115 : 135, 180);
  let shin = 9, thigh = 9, thighLock = 0, closest = 9;
  for (let i = iLeave; i <= iTop; i++) {
    const q = s.poses[i];
    for (const sd of M.SIDES) {
      shin = Math.min(shin, M.distToSeg2(q.bar, q.ankle[sd], q.knee[sd])[0]);
      thigh = Math.min(thigh, M.distToSeg2(q.bar, q.knee[sd], q.hip[sd])[0]);
    }
  }
  for (let i = iR1; i <= iRL; i++) {
    const q = s.poses[i];
    for (const sd of M.SIDES) for (const [a, b] of [[q.hip[sd], q.knee[sd]], [q.knee[sd], q.ankle[sd]]] as const) closest = Math.min(closest, M.distToSeg2(q.bar, a, b)[0]);
  }
  c("pull: closest bar to shin, side view (m)", shin, 0.06, 0.08);
  c("pull: closest bar to thigh, side view (m)", thigh, 0.08, 1);
  c("pull: no leg segment through the bar centre, side view (m)", closest, 0.0005, 1);
  thighLock = M.both((sd) => M.distToSeg2(pTop.bar, pTop.hip[sd], pTop.knee[sd])[0]);
  // the reference 0.085-0.105 is shorter than the mannequin allows: a drawn thigh (0.092) and the bar (0.0145) touch at 0.1065 between axes. Widened to 0.11 (conventional) and 0.13 (sumo: the fists must also clear the thighs, 0.092 + 0.04): docs/lift-motion.md
  c("lockout: bar to the hip-knee line (m); the reference 0.085-0.105 widened, docs/lift-motion.md", thighLock, 0.085, sumo ? 0.13 : 0.11);

  // ---- lockout
  c("lockout: knee angle (deg)", M.both((sd) => M.kneeAngle(pTop, sd)), 172, 178.9);
  c("lockout: torso lean forward of vertical (deg)", M.slope(pTop.pelvis, pTop.chest), 0, 4);
  c("lockout: bar height (m)", pTop.bar[1], sumo ? 0.7 : 0.78, sumo ? 0.72 : 0.8);
  let hold = 0;
  { const y = pTop.bar[1]; let k = iTop; while (k > iR1 && Math.abs(s.poses[k - 1].bar[1] - y) < 0.01) k--; let m = iTop; while (m < iRL && Math.abs(s.poses[m + 1].bar[1] - y) < 0.01) m++; hold = (m - k + 1) / M.HZ; }
  c("lockout: hold within 1 cm of the top (s)", hold, 0.5, 0.7);

  // ---- lowering
  c("lowering: knee more extended than going up at bar-at-knee (deg)", M.both((sd) => M.kneeAngle(s.poses[iKneeDn], sd)) - M.both((sd) => M.kneeAngle(s.poses[iKneeUp], sd)), 10, 180);
  c("lowering: back angle no higher than going up at bar-at-knee (deg, <= 0)", back(s.poses[iKneeDn]) - back(s.poses[iKneeUp]), -90, 0.01);

  // ---- tempo
  const rt = M.repTiming(s, 1, true);
  const tl = (n: number) => n;
  c("tempo: lead (s)", tl(rt.lead), 0.15, 0.25);
  c("tempo: pull (s)", rt.first, 1.3, 1.6);
  c("tempo: hold at the top (s)", rt.hold, 0.5, 0.7);
  c("tempo: lowering (s)", rt.second, 0.85, 1.05);
  c("tempo: floor rest (s)", rt.last, 0.35, 0.6);
  c("tempo: rep (s)", rt.rep, 3.1, 3.6);
  const bar = s.poses.map((q) => q.bar);
  const bs = M.speedSeries(bar);
  const y0 = s.poses[iLeave].bar[1];
  const t0 = (() => { for (let i = iLeave; i > rt.i0; i--) if (s.poses[i].bar[1] <= s.poses[rt.i0].bar[1] + 0.0005) return i; return rt.i0; })();
  void y0;
  c("tempo: bar speed 0.1 s after leaving the floor (m/s)", bs[t0 + 24], 0, 0.25);
  c("tempo: bar speed 0.3 s after leaving the floor (m/s)", bs[t0 + 72], 0, 0.45);
  let peak = 0;
  for (let i = rt.m0; i < rt.e0; i++) peak = Math.max(peak, bs[i]);
  c("tempo: peak bar speed (m/s)", peak, 0, 0.75);
  const pk = M.peaks(bar, rt.i0 + 3, rt.i1 - 3);
  c("tempo: bar acceleration (m/s2)", pk.accel, 0, 6);
  // slowing in the middle of the pull: a dip of at least 0.1 m/s between 0.5 and 0.6 m
  let pkb = 0, dip = 0;
  for (let i = rt.m0; i < rt.e0; i++) { pkb = Math.max(pkb, bs[i]); if (s.poses[i].bar[1] >= 0.5 && s.poses[i].bar[1] <= 0.6) dip = Math.max(dip, pkb - bs[i]); }
  c("pull: slowing around 0.5-0.6 m (m/s below the earlier peak)", dip, 0.1, 2);
  const rest0 = s.poses[0].bar[1];
  c("bar rests on the floor between reps (height above its rest, m)", Math.abs(s.poses[s.idx(r1.end) - 1].bar[1] - rest0), 0, 0.001);

  // ---- continuity
  const jump = M.maxJump(s);
  c("no joint moves more than 2 cm in 1/240 s (events)", jump.over2, 0, 0);
  c("no joint moves more than 1 cm in 1/240 s (cm, worst)", jump.cm, 0, 1);
  const hip = s.poses.map((q) => q.pelvis);
  c("hip jerk (m/s3)", M.peaks(hip, 0, hip.length).jerk, 0, 50000);

  // ---- approach
  const iG = s.poses.findIndex((q) => q.gripping);
  const tG = s.times[iG];
  const fe = M.footEvents(s, 0, iG);
  c("approach: number of steps", fe.steps.length, 4, 5);
  let alt = 1;
  for (let i = 1; i < fe.steps.length; i++) if (fe.steps[i].side === fe.steps[i - 1].side) alt = 0;
  c("approach: steps alternate (1 = yes)", alt, 1, 1);
  fe.steps.forEach((st, i) => {
    const last = i === fe.steps.length - 1;
    c(`approach: step ${i + 1} length (m)`, st.length, last ? 0.1 : 0.3, 0.8);
    c(`approach: step ${i + 1} peak lift (m)`, st.peakLift, 0.05, 0.11);
    c(`approach: step ${i + 1} duration (s)`, st.dur, 0.42, 0.62);
  });
  c("approach: heel higher than toe at toe-off (m)", Math.max(...fe.steps.map((st) => st.peakHeelOverToe)), 0.05, 0.07);
  c("approach: toe higher than heel at landing (m)", Math.max(...fe.steps.map((st) => st.peakToeOverHeel)), 0.04, 0.05);
  c("approach: planted foot slide (m)", fe.maxSlide, 0, 0.005);
  const swing = M.both((sd) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < iG; i++) { const q = s.poses[i]; const a = M.deg(Math.atan2(q.hand[sd][0] - q.shoulder[sd][0], q.shoulder[sd][1] - q.hand[sd][1])); lo = Math.min(lo, a); hi = Math.max(hi, a); } return hi - lo; });
  c("approach: arm swing peak to peak (deg)", swing, 30, 40);
  c("approach: first frame to the hands taking the bar (s)", tG, sumo ? 3.5 : 3.5, sumo ? 5.5 : 4.5);
  c("approach: time before rep 1 (s): the reference 4.0-4.5 conventional and 4.8-5.5 sumo, the conventional 0.3 s over for the slower hinge the reference asks for", r1.start, sumo ? 4.8 : 4.0, sumo ? 5.5 : 4.8);
  let still0 = 0;
  for (let i = 0; i < s.poses.length; i++) if (M.dist(s.poses[i].ankle.R, s.poses[0].ankle.R) > 0.001 || M.dist(s.poses[i].ankle.L, s.poses[0].ankle.L) > 0.001) { still0 = s.times[i]; break; }
  c("approach: opening stand-still (s)", still0, 0.15, 0.3);
  const grip = s.seg("grip")!;
  c("approach: hinge, grip and slack out (s): the hinge is no quicker than the pull", grip.end - grip.start, 1.3, 1.8);
  // hips dropping 1-3 cm and no bounce during the slack
  const slack = (() => { const a = s.idx(tG), b = s.idx(r1.start); let lo = 9, hi = -9; for (let i = a; i <= b; i++) { lo = Math.min(lo, s.poses[i].pelvis[1]); hi = Math.max(hi, s.poses[i].pelvis[1]); } return { drop: s.poses[a].pelvis[1] - s.poses[b].pelvis[1], range: hi - lo }; })();
  c("slack: hips drop between the grip and the pull (m)", slack.drop, 0.01, 0.03);
  c("slack: no hip bounce (range of the hip height minus the drop, m)", slack.range - slack.drop, 0, 0.004);

  // ---- ending: the head never moves faster than the bar did in the pull
  {
    const head = M.speedSeries(s.poses.map((p) => p.head));
    c("hinge to the bar: peak head speed (m/s)", Math.max(...head.slice(s.idx(grip.start), s.idx(grip.end))), 0, 1.0);
    c("standing up after the last rep: peak head speed (m/s)", Math.max(...head.slice(s.idx(s.seg("let go")!.start), s.poses.length)), 0, 1.0);
  }
  // ---- ending
  const letgo = s.seg("let go")!;
  const pe = s.poses[s.poses.length - 1];
  c("ending: after the last rep (s)", set.duration - r2.end, 1.5, 2.0);
  c("ending: final pelvis x from the rep-1 start pelvis (m)", Math.abs(pe.pelvis[0] - s.poses[iR1].pelvis[0]), 0, 0.3);
  c("ending: final hand to the bar (m)", Math.min(...M.SIDES.map((sd) => M.dist(pe.hand[sd], pe.bar))), 0.2, 5);
  c("ending: bar rests on the floor at the end (m above rest)", Math.abs(pe.bar[1] - rest0), 0, 0.001);
  let nearest = 9;
  for (let i = s.idx(letgo.start); i < s.poses.length; i++) nearest = Math.min(nearest, M.dist(s.poses[i].head, s.poses[i].bar));
  c("ending: head clear of the bar (m)", nearest, 0.15, 5);
  return out;
}

export function deadPairChecks(): Check[] {
  const a = deadStart("deadlift-conventional"), b = deadStart("deadlift-sumo");
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `sumo vs conventional: ${id}`, value, lo, hi, note: "" });
  c("sumo back minus conventional back at lift-off (deg)", b.back - a.back, 22, 90);
  c("sumo hips lower by (m)", a.hip - b.hip, 0.12, 1);
  c("sumo feet wider heel to heel by (m)", b.heels - a.heels, 0.5, 2);
  c("sumo hands narrower by (m)", a.hands - b.hands, 0.08, 1);
  const lock = (k: "deadlift-conventional" | "deadlift-sumo") => { const set = getSet(k, 2); const s = M.sample(set); const r1 = s.rep(1); return set.pose(M.extremeTime(s, r1.start, r1.end, "max")).bar[1]; };
  c("sumo lockout bar height lower by (m)", lock("deadlift-conventional") - lock("deadlift-sumo"), 0.06, 1);
  c("sumo bar travel shorter by (m)", lock("deadlift-conventional") - lock("deadlift-sumo"), 0.05, 1);
  return out;
}

function deadliftApproach(kind: "deadlift-conventional" | "deadlift-sumo"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
    const sumo = kind === "deadlift-sumo";
    const grip = s.seg("grip")!, lg = s.seg("let go")!;
    const lockT = M.extremeTime(s, r1.start, r1.end, "max"), pl = set.pose(lockT);
    // ---- stands tall at the start and at the end, and the two lifts agree
    for (const [label, p] of [["the first frame", s.poses[0]], ["the last frame", s.poses[s.poses.length - 1]]] as const) {
      c(`stands tall at ${label}: knee interior angle (deg)`, M.both((sd) => M.kneeAngle(p, sd)), 172, 178.9);
      c(`stands tall at ${label}: elbow interior angle (deg)`, M.both((sd) => M.elbowAngle(p, sd)), 172, 178.9);
      c(`stands tall at ${label}: head no lower than at lockout (m)`, p.head[1] - pl.head[1], -0.003, 1);
      c(`stands tall at ${label}: torso lean (deg)`, M.slope(p.pelvis, p.chest), 0, 4);
    }
    {
      const p = s.poses[s.poses.length - 1];
      c("end: hands hang this far from the midline (m)", M.both((sd) => Math.abs(p.hand[sd][2])), 0.2, 0.28);
    }
    // ---- the approach: smooth steps at an even cadence
    const iG = s.idx(grip.start);
    c("approach: worst joint step in 1/240 s (cm)", M.maxJump(s, 0, iG).cm, 0, 0.8);
    const fe = M.footEvents(s, 0, iG);
    const durs = fe.steps.map((x) => x.dur);
    c("approach: step durations differ by (s); the sumo's two steps out to the wide stance take 15% longer (the knee at the wide landing)", maxOver(durs) - minOver(durs), 0, sumo ? 0.08 : 0.03);
    c("approach: knee acceleration (m/s2)", maxOver(["R", "L"].map((sd) => M.peaks(s.poses.map((p) => p.knee[sd as "R" | "L"]), 2, iG).accel)), 0, 250);
    // ---- nothing through anything
    const free = (i: number) => i % 2 === 0 && !s.poses[i].gripping;
    const gf = M.limbGaps(s, 0, s.poses.length - 1, free);
    c("free hand (mitt) to the drawn thighs (gap, m)", gf.handThigh, -0.005, 9);
    c("free forearm to the drawn thighs (gap, m)", gf.forearmThigh, -0.005, 9);
    c("free upper arm to the drawn thighs (gap, m)", gf.upperThigh, -0.005, 9);
    const gg = M.limbGaps(s, s.idx(r1.start), iRL, (i) => i % 2 === 0);
    c("gripping: forearm to the drawn thighs (gap, m)", gg.forearmThigh, -0.005, 9);
    c(`gripping: fist to the drawn thighs (gap, m; ${sumo ? "the sumo fists press the thighs a little at the top: the bar touches them" : "clear"})`, gg.handThigh, sumo ? -0.025 : -0.005, 9);
    c("bar to the drawn thighs (gap, m)", gg.barThigh, -0.004, 9);
    c("bar to the drawn shins and calves (gap, m)", gg.barShin, -0.006, 9);
    let worst = 9;
    for (let i = 0; i < s.poses.length; i += 6) { const g = M.armToDrawnTrunk(s.poses[i]); worst = Math.min(worst, g.hand, g.forearm, g.elbow); }
    c("hands, forearms and elbows against the drawn torso (gap, m)", worst, -0.005, 9);
    c("pull: closest bar to shin, axis distance, 3D (m): between 6 and 8 cm", minOver(s.poses.slice(s.idx(r1.start), s.idx(r1.end)).flatMap((p) => M.SIDES.map((sd) => M.distToSeg2(p.bar, p.ankle[sd], p.knee[sd])[0]))), 0.06, 0.08);
    c("lockout: hold within 1 cm of the top (s): the reference 0.5-0.7, centred", (() => { const t = M.extremeTime(s, r1.start, r1.end, "max"), i = s.idx(t), y = s.poses[i].bar[1]; let a = i, b = i; while (a > iR1 && Math.abs(s.poses[a - 1].bar[1] - y) < 0.01) a--; while (b < iRL && Math.abs(s.poses[b + 1].bar[1] - y) < 0.01) b++; return (b - a + 1) / M.HZ; })(), 0.5, 0.65);
    void lg;
  return out;
}

function deadliftLockout(kind: "deadlift-conventional" | "deadlift-sumo"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
    const tTop = M.extremeTime(s, r1.start, r1.end, "max"), iTop = s.idx(tTop);
    // ---- the fists and forearms clear of the thighs and the trunk at lockout (the hull and the union of the drawn capsules)
    {
      const g = M.limbGaps(s, iTop, iTop, () => true);
      c("lockout: fist to the drawn thigh (m)", g.handThigh, 0, 9);
      c("lockout: forearm to the drawn thigh (m)", g.forearmThigh, 0.005, 9);
      const u = M.armsToTrunkUnion(s.poses[iTop]);
      c("lockout: forearm to the drawn trunk as the union of its capsules, hips included (m)", u.forearm, 0.002, 9);
      c("lockout: fist to the drawn trunk (m)", u.hand, 0.01, 9);
      const T = M.drawnTorso(s.poses[iTop]);
      let hip = 9;
      for (const sd of M.SIDES) for (let k = 0; k <= 10; k++) { const pt = M.add(s.poses[iTop].elbow[sd], M.mul(M.sub(s.poses[iTop].wrist[sd], s.poses[iTop].elbow[sd]), k / 10)); hip = Math.min(hip, M.hullSigned(pt, T.lower) - 0.042); }
      c("lockout: forearm to the drawn lower trunk hull, hips included (m)", hip, 0.002, 9);
    }
    // ---- the free arm while walking up: forearm and hand clear of the drawn trunk (swing 1-2 cm further out)
    {
      let fore = 9, hand = 9;
      for (let i = 0; i < s.poses.length; i += 2) { if (s.poses[i].gripping) continue; const g = M.armsToTrunkUnion(s.poses[i]); fore = Math.min(fore, g.forearm); hand = Math.min(hand, g.hand); }
      c("free arm: forearm to the drawn trunk (union of capsules), worst over the set (m)", fore, 0.01, 9);
      c("free arm: fist to the drawn trunk, worst over the set (m)", hand, 0.02, 9);
    }
    // ---- no snap anywhere: the pelvis and the knees ease into the lowering and into every toe-off
    {
      const P = s.poses.map((p) => p.pelvis);
      c("pelvis acceleration over the whole set (m/s2)", M.peaks(P, 2, P.length - 3).accel, 0, 40);
      c("pelvis jerk over the whole set (m/s3)", M.peaks(P, 2, P.length - 3).jerk, 0, 25000);
      const grip = s.seg("grip")!;
      const iG = s.idx(grip.start);
      c("approach: knee acceleration (m/s2)", maxOver(M.SIDES.map((sd) => M.peaks(s.poses.map((p) => p.knee[sd]), 2, iG).accel)), 0, 100);
      // the lowering: the hips start from rest and ease into the hinge (the hips' position is the square root of the bar's height below the top: a table coarse near the top made it a snap)
      const holdEnd = (() => { let i = iTop; const y = s.poses[iTop].bar[1]; while (i < iRL && Math.abs(s.poses[i].bar[1] - y) < 0.0005) i++; return i; })();
      const acc = (i: number) => M.len(M.add(M.sub(s.poses[i + 1].pelvis, M.mul(s.poses[i].pelvis, 2)), s.poses[i - 1].pelvis)) * M.HZ * M.HZ;
      c("lowering: largest pelvis acceleration from 0.15 s before the bar leaves the top to 0.5 s after (m/s2)", maxOver(Array.from({ length: Math.round(0.65 * M.HZ) }, (_, k) => acc(holdEnd - Math.round(0.15 * M.HZ) + k))), 0, 30);
      const sp = (i: number) => M.dist(s.poses[i].pelvis, s.poses[i - 1].pelvis) * M.HZ;
      c("lowering: largest rise of the pelvis speed in one 1/240 s step, from 0.15 s before the bar leaves the top to 0.5 s after (m/s)", maxOver(Array.from({ length: Math.round(0.65 * M.HZ) }, (_, k) => sp(holdEnd - Math.round(0.15 * M.HZ) + k + 1) - sp(holdEnd - Math.round(0.15 * M.HZ) + k))), 0, 0.15);
    }
    // ---- bar speed with margin, and the bar against the shin
    {
      const bar = s.poses.map((p) => p.bar), bs = M.speedSeries(bar), rt = M.repTiming(s, 1, true);
      const t0 = (() => { for (let i = s.idx(M.leaveFloorTime(s)!); i > rt.i0; i--) if (s.poses[i].bar[1] <= s.poses[rt.i0].bar[1] + 0.0005) return i; return rt.i0; })();
      c("bar speed 0.1 s after lift-off with margin under the 0.25 cap (m/s)", bs[t0 + 24], 0, 0.23);
      const gg = M.limbGaps(s, iR1, iRL, (i) => i % 2 === 0);
      c("bar to the drawn shin and calf, the closest in the pull (m): the bar does not enter the leg", gg.barShin, 0, 9);
      c("bar to the drawn thigh, the closest in the pull and at lockout (m)", gg.barThigh, -0.0005, 9);
    }
  return out;
}

function deadliftPullAndWalkUp(kind: "deadlift-conventional" | "deadlift-sumo"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1);
    const sumo = kind === "deadlift-sumo";
    const rt = M.repTiming(s, 1, true), bs = M.speedSeries(s.poses.map((p) => p.bar));
    const iG = s.poses.findIndex((q) => q.gripping);
    // ---- the lowering never faster than the pull's cap, over the whole rep
    {
      let pk = 0;
      for (let i = rt.m0; i < rt.a; i++) pk = Math.max(pk, bs[i]);
      c("peak bar speed over the whole rep, lowering included (m/s)", pk, 0, 0.74);
    }
    // ---- the lead and the first 0.1 s, however the instant the bar leaves the floor is taken (0.5 mm to 1 cm)
    {
      const y0 = s.poses[rt.i0].bar[1];
      const leave = (th: number) => { let i = rt.i0; while (i < rt.i1 && s.poses[i].bar[1] <= y0 + th) i++; return i; };
      c("lead, bar 2 mm off the floor (s): centred in the reference 0.15-0.25", (leave(0.002) - rt.i0) / M.HZ, 0.17, 0.2);
      c("lead, bar 1 mm off the floor (s)", (leave(0.001) - rt.i0) / M.HZ, 0.15, 0.25);
      c("lead, bar 1 cm off the floor (s)", (leave(0.01) - rt.i0) / M.HZ, 0.15, 0.246);
      for (const th of [0.002, 0.005]) c(`bar speed 0.1 s after it is ${th * 1000} mm off the floor, with margin under the 0.25 cap (m/s)`, bs[leave(th) + 24], 0, 0.23);
      c("pull stays inside the reference 1.3-1.6 s with room (s)", rt.first, 1.31, 1.6);
      c("rep total inside the reference 3.1-3.6 s with room (s)", rt.rep, 3.1, 3.59);
    }
    // ---- the walk-up: step time, arm swing by the wrist as well as by the hand, the knee at the wide landing, the largest frame step
    {
      const fe = M.footEvents(s, 0, iG);
      const alt = (h: number) => { const ds: number[] = []; for (const sd of M.SIDES) { let run = 0; for (let i = 0; i <= iG; i++) { if (s.poses[i].ankle[sd][1] > 0.08 + h) run++; else if (run) { ds.push(run / M.HZ); run = 0; } } } return ds; };
      const d1 = alt(0.01);
      c("approach: steps by the time the ankle is more than 1 cm off the floor, the shortest (s); the reference 0.42-0.48", minOver(d1), 0.42, 1);
      c("approach: steps by the time the ankle is more than 1 cm off the floor, the mean (s)", M.mean(d1), 0.43, 0.5);
      const sw = (f: (p: any, sd: M.Side) => readonly number[]) => maxOver(M.SIDES.map((sd) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < iG; i++) { const q = s.poses[i]; const w = f(q, sd); const a = M.deg(Math.atan2(w[0] - q.shoulder[sd][0], q.shoulder[sd][1] - w[1])); lo = Math.min(lo, a); hi = Math.max(hi, a); } return hi - lo; }));
      c("approach: arm swing peak to peak by the wrist, the larger arm (deg): the reference 30-40, off the ceiling", sw((q, sd) => q.wrist[sd]), 30, 38.9);
      c("approach: arm swing peak to peak by the hand, the larger arm (deg)", sw((q, sd) => q.hand[sd]), 30.5, 40);
      let knee = 0, step = 0;
      for (const sd of M.SIDES) knee = Math.max(knee, M.peaks(s.poses.map((q) => q.knee[sd]), 2, iG).accel);
      for (let i = 1; i <= iG; i++) for (const sd of M.SIDES) for (const j of ["knee", "wrist", "hand"] as const) step = Math.max(step, M.dist(s.poses[i][j][sd], s.poses[i - 1][j][sd]) * 100);
      c("approach: knee acceleration (m/s2)", knee, 0, 45);
      c("approach: largest step of a knee, wrist or hand in 1/240 s (cm)", step, 0, 0.75);
      void fe;
    }
    // ---- recorded: the numbers the drawn mannequin forbids (docs/lift-motion.md)
    {
      const d = deadStart(kind as "deadlift-conventional" | "deadlift-sumo"), p = d.p, tTop = M.extremeTime(s, r1.start, r1.end, "max"), pT = set.pose(tTop);
      c("recorded: lockout, bar to the hip-knee line (m); the reference 0.085-0.105 against a drawn thigh 0.092 + bar 0.0145" + (sumo ? " + fists 0.04" : ""), M.both((sd) => M.distToSeg2(pT.bar, pT.hip[sd], pT.knee[sd])[0]), 0.1, sumo ? 0.1285 : 0.1075);
      if (!sumo) {
        c("recorded: conventional, bar ahead of the ankle at lift-off (m): the bar stands off the shin for the drawn calf (radius 0.064)", p.bar[0] - M.mean(M.SIDES.map((sd) => p.ankle[sd][0])), 0.115, 0.135);
        c("recorded: conventional, shin from vertical at lift-off (deg)", d.shin, 14, 17.5);
      } else {
        c("recorded: sumo, back angle at lift-off (deg); the reference asks 59-60: more back angle puts the shin past 8 deg or the bar into the calf", d.back, 56.5, 60);
        c("recorded: sumo, shin from vertical at lift-off (deg), inside the reference 0-8", d.shin, 0, 8);
      }
    }
  return out;
}

/** Every check of one deadlift lift. */
export const deadliftSuite = (kind: "deadlift-conventional" | "deadlift-sumo"): Check[] => [...deadChecks(kind), ...deadliftApproach(kind), ...deadliftLockout(kind), ...deadliftPullAndWalkUp(kind)];
