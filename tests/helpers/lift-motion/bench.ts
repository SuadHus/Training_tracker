// The reference targets for the bench, one Check each.
import * as M from "./measure";
import { barAt1kHz, barToHull, maxOver } from "./util";
import { type Check, getSet } from "./check";

const PAD = 0.44;

type BenchNumbers = {
  hands: number; flare: number; abduction: number; touchX: number; barAboveShoulder: number; elbowAngle: number; elbowZ: number; elbowDrop: number;
  tiltSide: number; leanIn: number; lead: number; pathLength: number; travel: number; p: ReturnType<M.Sampled["set"]["pose"]>;
};

/** Seen from above: the angle of the upper arm from the line of the body toward the feet, 90 = straight out to the side. */
const flareOf = (p: BenchNumbers["p"]) => M.both((sd) => { const u = M.sub(p.elbow[sd], p.shoulder[sd]); return M.deg(Math.atan2(Math.abs(u[2]), u[0])); });
/** How far toward the feet of the bar the elbows are, seen from the side (m). */
const leadOf = (p: BenchNumbers["p"]) => M.both((sd) => p.elbow[sd][0] - p.hand[sd][0]);
/** The forearm seen from the front: how far it leans in toward the bar's middle on its way up (deg), positive when the elbow is outside the wrist. */
const leanInOf = (p: BenchNumbers["p"]) => M.both((sd) => { const w = M.sub(p.wrist[sd], p.elbow[sd]); return M.deg(Math.atan2((sd === "R" ? -1 : 1) * w[2], w[1])); });

export function benchNumbers(kind: "bench" | "bench-close"): BenchNumbers {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const r1 = s.rep(1);
  const rt = M.repTiming(s, 1);
  const tT = M.extremeTime(s, r1.start, r1.end, "min");
  const p = set.pose(tT);
  let len = 0;
  for (let i = rt.m0; i < rt.e0; i++) len += M.dist(s.poses[i].bar, s.poses[i + 1].bar);
  return {
    p, hands: M.dist(p.hand.R, p.hand.L), flare: flareOf(p), touchX: p.bar[0], barAboveShoulder: p.bar[1] - p.shoulder.R[1],
    // the humerus against the plane that halves the body (docs/bench-press-elbows.md, T1 and T2)
    abduction: M.both((sd) => M.deg(Math.asin(Math.abs(p.elbow[sd][2] - p.shoulder[sd][2]) / M.dist(p.elbow[sd], p.shoulder[sd])))),
    elbowAngle: M.both((sd) => M.elbowAngle(p, sd)), elbowZ: M.both((sd) => Math.abs(p.elbow[sd][2])), elbowDrop: M.both((sd) => p.shoulder[sd][1] - p.elbow[sd][1]),
    tiltSide: Math.max(...M.SIDES.map((sd) => Math.abs(M.slope(p.elbow[sd], p.wrist[sd])))),
    leanIn: leanInOf(p), lead: leadOf(p),
    pathLength: len, travel: s.poses[rt.i0].bar[1] - p.bar[1],
  };
}

function benchChecks(kind: "bench" | "bench-close"): Check[] {
  const close = kind === "bench-close";
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
  const rack = s.seg("rack")!, letgo = s.seg("let go")!;
  const n = benchNumbers(kind);
  const p = n.p;
  const rt = M.repTiming(s, 1);

  // ---- grip and touch (the sources are in docs/bench-press-elbows.md; [K17], [L21], [M22], [McL] are its keys)
  const lockP = s.poses[iR1];
  // The grips are those lifters were measured with. The bench: 175% of the shoulder width between the forefingers, the grip trained lifters
  // choose [K17]. The close grip: 105%, among the narrow grips of [K17] (95%), [L21] (100%) and [M22] (112%). The mannequin's shoulder
  // joints are 0.38 apart and the middle of a hand is 0.045 outside its forefinger.
  c("hand-to-hand at lockout (m)", M.dist(lockP.hand.R, lockP.hand.L), close ? 0.48 : 0.74, close ? 0.52 : 0.78);
  c("hand-to-hand at the touch (m)", n.hands, close ? 0.48 : 0.74, close ? 0.52 : 0.78);
  c("arm to bar at lockout, the inner angle from the shoulder joint to the middle of the hand (deg): 65 wide, 75 medium, 85 narrow [M22]", M.both((sd) => M.deg(Math.acos(Math.abs(lockP.hand[sd][2] - lockP.shoulder[sd][2]) / M.dist(lockP.hand[sd], lockP.shoulder[sd])))), close ? 83 : 66, close ? 88 : 75);
  // A judgement: the only numbers near it are read off a chart of an "abduction" whose plane the paper does not state (53 to 58 medium to wide, 42 narrow [L21]).
  c("elbow flare at the touch, seen from above (deg): a judgement beside 53 to 58 and 42 narrow, a chart of an angle of unstated plane [L21]", n.flare, close ? 32 : 50, close ? 46 : 66);
  c("upper arm to the plane that halves the body at the touch (deg): 59.3 +/- 8.2 to 66.1 +/- 7.0 medium to wide, 37.9 +/- 7.2 narrow with the elbows in [M22]", n.abduction, close ? 30.7 : 51.1, close ? 45.1 : 73.1);
  c("touch point toward the feet from the shoulder line (m): 0.125 to 0.134 [L21][McL], lower with a close grip", n.touchX, close ? 0.15 : 0.12, close ? 0.2 : 0.15);
  // The bar's travel is what is measured (0.41 +/- 0.04 m, close grip 0.43 +/- 0.05 [K17]); how high the bar is above the shoulder joints
  // at the chest follows from it and the length of the arm.
  c("bar travel from lockout to the chest (m): 0.41 +/- 0.04, close grip 0.43 +/- 0.05 [K17]", n.travel, close ? 0.38 : 0.37, close ? 0.48 : 0.45);
  c("bar centre above the shoulder joints at the touch (m)", n.barAboveShoulder, 0.18, 0.27);
  c("elbow joints below the shoulder joints at the touch (m): level or below is the rule [IPF26]", n.elbowDrop, 0, 0.15);
  c("forearm at the touch, side view (deg from upright): near upright (coaching); the close grip's elbows are ahead of the bar", n.tiltSide, 0, close ? 16 : 5);
  // What was measured is the moment arm of the bar's force about the elbow, its direction not given: 0.00 m wide, 0.03 medium, 0.08 narrow [L21].
  c("elbows ahead of the bar at the touch (m): a judgement from the bar's moment arm about the elbow, 0.00 wide, 0.03 medium, 0.08 narrow [L21]", n.lead, close ? 0.03 : 0, close ? 0.08 : 0.03);
  c("forearm leaning in at the touch, front view (deg): a judgement, nobody measured it at the chest; the elbows are outside the hands, further with a close grip", n.leanIn, close ? 18 : 5, close ? 34 : 20);
  // One method reads 55 to 68 (medium to wide) and 51 (narrow) [L21]; another 79 to 93 and 66 to 70 [M22], which this mannequin, its chest 20 cm above its shoulder joints, does not reach.
  c("elbow interior angle at the touch (deg): 55 to 68 medium to wide, 51 narrow [L21]; the 79 to 93 and 66 to 70 of [M22] are not reached", n.elbowAngle, close ? 40 : 45, close ? 58 : 70);
  c("elbow z at the touch (m)", n.elbowZ, close ? 0.3 : 0.38, 1);
  let wristBelow = 9, handLevel = 0, barLevel = 0;
  for (let i = 0; i < s.poses.length; i++) {
    const q = s.poses[i];
    for (const sd of M.SIDES) wristBelow = Math.min(wristBelow, q.bar[1] - q.wrist[sd][1]);
    if (q.gripping) { handLevel = Math.max(handLevel, Math.abs(q.hand.R[1] - q.hand.L[1]), Math.abs(q.hand.R[1] - q.bar[1])); barLevel = Math.max(barLevel, Math.abs(q.hand.R[0] - q.hand.L[0])); }
  }
  c("wrist below the bar centre (min, m): the bar lies on the heel of the palm", wristBelow, 0.05, 0.07);
  c("hands on the bar at the same height in every gripping frame (m)", handLevel, 0, 0.001);
  c("bar level: both hands at the same x (m)", barLevel, 0, 0.001);

  // ---- body and setup
  const wLine = (() => { const a = p.chest, b = p.pelvis, w = p.waist; const u = M.dot(M.sub(w, a), M.sub(b, a)) / M.dot(M.sub(b, a), M.sub(b, a)); const q = M.add(a, M.mul(M.sub(b, a), u)); return w[1] - q[1]; })();
  c("waist above the straight pelvis-chest line (m)", wLine, 0.04, 0.07);
  c("shoulder joints above the pad (m)", p.chest[1] - PAD, 0.07, 0.11);
  c("pelvis height (m)", p.pelvis[1], 0.52, 0.56);
  c("head centre height (m)", p.head[1], 0.545, 0.56);
  c("head centre to the shoulder line (m)", M.dist(p.head, p.chest), 0.19, 0.22);
  c("at t=0 bar x minus head x (m)", Math.abs(s.poses[0].bar[0] - s.poses[0].head[0]), 0, 0.04);

  // ---- stillness
  let still = { head: 0, chest: 0, pelvis: 0, feet: 0 }, floor = 0, yawSym = 1;
  const iE = s.idx(rack.end);
  for (let i = iR1; i <= iE; i++) {
    const q = s.poses[i];
    still.head = Math.max(still.head, M.dist(q.head, lockP.head));
    still.chest = Math.max(still.chest, M.dist(q.chest, lockP.chest));
    still.pelvis = Math.max(still.pelvis, M.dist(q.pelvis, lockP.pelvis));
    for (const sd of M.SIDES) { still.feet = Math.max(still.feet, M.dist(q.ankle[sd], lockP.ankle[sd]), M.dist(q.heel[sd], lockP.heel[sd]), M.dist(q.toe[sd], lockP.toe[sd])); floor = Math.max(floor, q.heel[sd][1], q.toe[sd][1]); }
  }
  c("head moves from rep-1 start to the re-rack (m)", still.head, 0, 0.005);
  c("shoulders move from rep-1 start to the re-rack (m)", still.chest, 0, 0.005);
  c("pelvis moves from rep-1 start to the re-rack (m)", still.pelvis, 0, 0.005);
  c("feet move from rep-1 start to the re-rack (m)", still.feet, 0, 0.005);
  c("heel and toe on the floor (m)", floor, 0, 0.001);
  const yawR = M.deg(Math.atan2(p.toe.R[2] - p.heel.R[2], p.toe.R[0] - p.heel.R[0])), yawL = M.deg(Math.atan2(p.toe.L[2] - p.heel.L[2], p.toe.L[0] - p.heel.L[0]));
  c("toe yaw, right foot (deg, out is +)", yawR, 10, 15);
  c("toe yaw, left foot mirrored (deg, out is -)", -yawL, 10, 15);
  c("toe yaws mirrored (sum, deg)", yawR + yawL, -0.5, 0.5);
  c("ankle x behind the knee x minus 0.03 (m)", M.both((sd) => p.knee[sd][0] - 0.03 - p.ankle[sd][0]), 0, 1);
  c("knee interior angle (deg)", M.both((sd) => M.kneeAngle(p, sd)), 85, 100);
  let padHit = 9;
  for (let i = 0; i < s.poses.length; i++) {
    const q = s.poses[i];
    for (const sd of M.SIDES) for (const j of [q.knee[sd], q.ankle[sd], q.elbow[sd]]) if (Math.abs(j[2]) < 0.15 && j[0] > -0.42 && j[0] < 0.8) padHit = Math.min(padHit, j[1] - PAD);
  }
  c("knee, ankle and elbow clear above the pad where they are over it (m)", padHit, 0, 9);
  const lock = (() => { const q = set.pose(M.extremeTime(s, r1.start, r1.end, "max")); return M.both((sd) => M.elbowAngle(q, sd)); })();
  c("elbow interior angle at lockout (deg); the reference lockout is 171.9", lock, 170, 179);

  // ---- lift-off
  const hook = s.poses[0].bar;
  c("lift-off: hooks to over the shoulders, horizontal (m)", lockP.bar[0] - hook[0], 0.15, 0.2);
  // The hooks are set for the lifter: the bar rises 8 cm to lockout, and 11 with the close grip, whose arms stand straighter under it.
  c("lift-off: rise (m)", Math.max(...s.poses.slice(0, iR1 + 1).map((q) => q.bar[1])) - hook[1], close ? 0.09 : 0.06, close ? 0.13 : 0.1);
  c("bar x at the start of rep 1 (m)", Math.abs(lockP.bar[0]), 0, 0.03);
  c("bar returns to the start hook position (m)", M.dist(s.poses[s.poses.length - 1].bar, hook), 0, 0.01);

  // ---- timing
  // Between the 1 cm bands at the top and at the chest. The reference is 0.95 to 1.10 s for a bar that travels 0.50 m; over the measured
  // 0.40 to 0.44 m the first and the last centimetre are a larger share, so the same descent (1.06 s by 1 mm bands, checked below) reads shorter here.
  c("descent (s)", rt.first, 0.9, 1.1);
  c("hold within 1 mm of the bottom (s)", (() => { const b = rt.ext; let k = rt.e0, m = rt.e0; while (Math.abs(s.poses[k].bar[1] - b) >= 0.001 && k < rt.a) k++; m = k; while (k > rt.m0 && Math.abs(s.poses[k - 1].bar[1] - b) < 0.001) k--; while (m < rt.a && Math.abs(s.poses[m + 1].bar[1] - b) < 0.001) m++; return (m - k + 1) / M.HZ; })(), 0.2, 0.3);
  // Between 1 cm bands as well: the reference 0.80 to 1.00 s is for 0.50 m of travel; the whole press (by 1 mm bands, checked below) is 0.94 s.
  c("press (s)", rt.second, 0.75, 1.0);
  c("lockout (s)", rt.last, 0.35, 0.5);
  c("rep (s)", rt.rep, 2.4, 2.8);
  const durations = [8].map((k) => getSet(kind, k).duration);
  c("duration, 8 reps (s): the reference 24-27 s plus the last reps' grind", durations[0], 24, 29);
  c("tail after the last rep (s)", set.duration - r2.end, 2.8, 3.2);

  // ---- smoothness
  const bar = s.poses.map((q) => q.bar);
  const pk = M.peaks(bar, iR1 + 3, iRL - 3);
  const jump = M.maxJump(s);
  c("no joint moves more than 2 cm in 1/240 s (events)", jump.over2, 0, 0);
  c("no joint moves more than 1 cm in 1/240 s (cm, worst)", jump.cm, 0, 1);
  c("bar |accel| during reps (m/s2)", pk.accel, 0, 25);
  c("bar jerk during reps (m/s3)", pk.jerk, 0, 8000);
  const bs = M.speedSeries(bar);
  let peakUp = 0;
  for (let i = rt.e1; i < rt.a; i++) peakUp = Math.max(peakUp, bs[i]);
  // The tempo of the rep is the reference's; the speeds follow from it and from the bar's travel, which is the measured 0.40 to 0.44 m and not
  // the 0.50 m the reference speeds were written for: the floors below are the reference's 0.45 m/s times 0.40 / 0.50, with a little room.
  c("bar peak speed up (m/s)", peakUp, 0, 0.8);
  const yBot = s.poses[rt.e1].bar[1], yTop = s.poses[rt.a].bar[1];
  let minMid = 9;
  for (let i = rt.e1; i < rt.a; i++) { const f = (s.poses[i].bar[1] - yBot) / (yTop - yBot); if (f >= 0.25 && f <= 0.8) minMid = Math.min(minMid, bs[i]); }
  c("min speed between 25% and 80% of the ascent (m/s)", minMid, 0.38, 0.8 * peakUp);
  let leaveI = rt.e0;
  for (let i = rt.e1; i > rt.e0; i--) if (s.poses[i].bar[1] <= rt.ext + 0.0002) { leaveI = i; break; }
  const vy = (i: number) => (s.poses[i + 1].bar[1] - s.poses[i - 1].bar[1]) * M.HZ / 2;
  c("vy at touch + 25 ms (m/s)", vy(leaveI + 6), 0, 0.15);
  c("vy at touch + 50 ms (m/s)", vy(leaveI + 12), 0, 0.25);
  c("vy at touch + 75 ms (m/s)", vy(leaveI + 18), 0, 0.35);
  c("vy at touch + 100 ms (m/s)", vy(leaveI + 24), 0, 0.45);
  // up path differs from the down path: x of the bar at equal heights
  let diff = 0;
  for (let h = 0.1; h <= 0.9; h += 0.05) {
    const y = yBot + (yTop - yBot) * h;
    let xd = 0, xu = 0;
    for (let i = rt.m0; i < rt.e0; i++) if (s.poses[i].bar[1] >= y && s.poses[i + 1].bar[1] < y) xd = s.poses[i].bar[0];
    for (let i = rt.e1; i < rt.a; i++) if (s.poses[i].bar[1] <= y && s.poses[i + 1].bar[1] > y) xu = s.poses[i].bar[0];
    diff = Math.max(diff, xd - xu);
  }
  c("the bar comes up nearer the head than it went down, at equal height (most, m)", diff, close ? 0.035 : 0.027, close ? 0.052 : 0.042);
  c("bar x at lockout minus the shoulder line (m)", Math.abs(lockP.bar[0] - lockP.chest[0]), 0, 0.03);

  // ---- ending
  let handMin = 9, handZ = 0, innerHit = 9;
  const iEnd = s.poses.length - 1;
  const pe = s.poses[iEnd];
  c("end: both hands above the chest, y at least 0.60 m", Math.min(...M.SIDES.map((sd) => pe.hand[sd][1])), 0.6, 5);
  c("end: elbows above y 0.30 (min, m)", Math.min(...M.SIDES.map((sd) => pe.elbow[sd][1])), 0.3, 5);
  for (let i = s.idx(letgo.start); i <= iEnd; i++) {
    const q = s.poses[i];
    for (const sd of M.SIDES) for (const j of [q.hand[sd], q.elbow[sd]]) {
      // the torso: half-width 0.17 around the axis from the pelvis to the chest, depth 0.10 -> a capsule of radius 0.17 around the axis, flattened
      const dd = M.distToSeg3(j, q.pelvis, q.chest);
      innerHit = Math.min(innerHit, dd);
      if (Math.abs(j[2]) < 0.15) handMin = Math.min(handMin, j[1] - PAD); // over the pad: above it (an elbow hanging outside the pad's edge is below its top)
    }
  }
  c("end: hand and elbow clear of the torso axis (min distance, m)", innerHit, 0.17, 5);
  c("end: hand and elbow clear above the pad where they are over it (min, m; 9 = never over it)", handMin, 0, 9);
  void handZ; void yawSym; void rack;
  return out;
}

export function benchPairChecks(): Check[] {
  const b = benchNumbers("bench"), cl = benchNumbers("bench-close");
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `bench vs close: ${id}`, value, lo, hi, note: "" });
  c("close touch lies farther toward the feet by (m): lower (coaching), though one study measured no difference [L21]", cl.touchX - b.touchX, 0.02, 0.06);
  c("close bar travel longer by (m): 0.02 [K17], 0.03 to 0.06 [L21]", cl.travel - b.travel, 0.01, 0.06);
  c("close grip: the upper arm nearer the body at the touch by (deg) [M22][L21]", b.abduction - cl.abduction, 5, 30);
  c("close grip: the forearms lean in more at the touch by (deg)", cl.leanIn - b.leanIn, 8, 30);
  c("close bar path (lockout to touch) longer by (m)", cl.pathLength - b.pathLength, 0.03, 1);
  c("close elbow interior angle at the touch minus the bench value (deg)", cl.elbowAngle - b.elbowAngle, -20, 0);
  const rb = M.repTiming(M.sample(getSet("bench", 2)), 1).rep, rc = M.repTiming(M.sample(getSet("bench-close", 2)), 1).rep;
  c("close rep longer than bench rep by (s)", rc - rb, 0.1, 1);
  return out;
}

function benchContact(kind: "bench" | "bench-close"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
    // ---- the bar rests on the chest as drawn: it sinks in a few millimetres, not 2 cm
    let barChest = 9;
    for (let i = iR1; i <= iRL; i += 4) barChest = Math.min(barChest, M.barToDrawnTorso(s.poses[i]));
    // and at the touch itself, the frame that matters most
    barChest = Math.min(barChest, M.barToDrawnTorso(set.pose(M.extremeTime(s, r1.start, r1.end, "min"))));
    c("bar to the drawn upper torso, worst over the reps (m; negative is inside): the bar rests on the chest, a few millimetres in", barChest, -0.006, 0);
    // ---- the bar's speed over the whole rep, down as well as up
    const rt = M.repTiming(s, 1);
    const bar = s.poses.map((p) => p.bar), bs = M.speedSeries(bar);
    c("bar peak speed down, 3D (m/s)", maxOver(bs.slice(rt.m0, rt.e0)), 0, 0.8);
    c("bar peak horizontal speed on the way down (m/s)", maxOver(Array.from({ length: rt.e0 - rt.m0 }, (_, k) => Math.abs(bar[rt.m0 + k + 1][0] - bar[rt.m0 + k - 1][0]) * M.HZ / 2)), 0, 0.5);
    // ---- the launch off the chest, measured from the moment the bar leaves the 1 mm band as well
    let li = rt.e0;
    for (let i = rt.e1; i > rt.e0; i--) if (s.poses[i].bar[1] <= rt.ext + 0.001) { li = i + 1; break; }
    const vy = (i: number) => ((bar[i + 1][1] - bar[i - 1][1]) * M.HZ) / 2;
    c("launch: vy 25 ms after the bar leaves the 1 mm band (m/s)", vy(li + 6), 0, 0.14);
    c("launch: vy 50 ms after (m/s)", vy(li + 12), 0, 0.24);
    c("launch: vy 75 ms after (m/s)", vy(li + 18), 0, 0.33);
    // ---- the lifter on the pad: the drawn pelvis and hip balls sit on it (a few mm), the seat ball may sink into the pad's give
    let sink = 9, seat = 9;
    for (const i of [iR1, iRL]) {
      const p = s.poses[i], T = M.drawnTorso(p);
      for (const ball of [[p.pelvis, 0.104], [p.hip.R, 0.1], [p.hip.L, 0.1]] as const) sink = Math.min(sink, ball[0][1] - ball[1] - 0.44);
      seat = Math.min(seat, T.lower[2][0][1] - T.lower[2][1] - 0.44);
    }
    c("pelvis and hip balls against the pad top (m; negative is sunk in)", sink, -0.0005, 9);
    c("the seat ball against the pad top (m)", seat, -0.04, 9);
    // ---- the arms against the drawn torso, all frames
    let worst = 9;
    for (let i = 0; i < s.poses.length; i += 6) { const g = M.armToDrawnTrunk(s.poses[i]); worst = Math.min(worst, g.hand, g.forearm, g.elbow); }
    c("hands, forearms and elbows against the drawn torso (m)", worst, -0.005, 9);
  return out;
}

function benchTrunkAndLockout(kind: "bench" | "bench-close"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
    const tT = M.extremeTime(s, r1.start, r1.end, "min"), pt = set.pose(tT);
    // ---- the arms against the drawn trunk as the drawing fills it (the convex hull: the armpit too), all frames of the reps
    {
      let upper = 9, fore = 9;
      for (let i = iR1; i <= iRL; i += 2) { const g = M.armsToTrunkHull(s.poses[i]); upper = Math.min(upper, g.upper); fore = Math.min(fore, g.forearm); }
      c("upper arm (from half way down it) to the drawn trunk hull over the reps, signed (m)", upper, 0, 9);
      c("forearm to the drawn trunk hull over the reps, signed (m)", fore, 0, 9);
    }
    // ---- contact, within 0 to -3 mm: the chest and the pelvis
    c("bar on the drawn chest at the touch (m, negative is inside): it rests there, a few millimetres in", barToHull(pt), -0.006, 0);
    {
      let sink = 9;
      for (const i of [iR1, iRL]) { const p = s.poses[i]; sink = Math.min(sink, p.pelvis[1] - 0.104 - 0.44, p.hip.R[1] - 0.1 - 0.44); }
      c("the drawn pelvis against the pad top (m): at or above it", sink, -0.0005, 9);
    }
    // ---- the lockout, and the sticking region by vertical speed as well as by 3D speed
    {
      const lock = M.both((sd) => M.elbowAngle(set.pose(M.extremeTime(s, r1.start, r1.end, "max")), sd));
      c("elbow interior angle at lockout (deg): the arms straighten", lock, 170, 178.9);
      const rt = M.repTiming(s, 1), bar = s.poses.map((p) => p.bar);
      const yBot = s.poses[rt.e1].bar[1], yTop = s.poses[rt.a].bar[1];
      let minVy = 9;
      for (let i = rt.e1 + 1; i < rt.a; i++) { const f = (s.poses[i].bar[1] - yBot) / (yTop - yBot); if (f >= 0.25 && f <= 0.8) minVy = Math.min(minVy, ((bar[i + 1][1] - bar[i - 1][1]) * M.HZ) / 2); }
      c("vertical bar speed between 25% and 80% of the ascent, least (m/s)", minVy, 0.38, 0.8);
      const fine = M.repTiming(s, 1, false, 0.001);
      c("descent by 1 mm bands as well (s)", fine.first, 0.95, 1.1);
      c("lockout by 1 mm bands as well (s)", fine.last, 0.35, 0.5);
    }
    // ---- the ending: the arms come to rest, they are not held up
    {
      const pe = s.poses[s.poses.length - 1];
      c("end: both elbows come to rest at or below y 0.50 (largest, m): not held up in a V", Math.max(...M.SIDES.map((sd) => pe.elbow[sd][1])), 0, 0.5);
      c("end: both elbows stay at least 0.20 m from the midline (least, m)", Math.min(...M.SIDES.map((sd) => Math.abs(pe.elbow[sd][2]))), 0.2, 5);
      c("end: hands rest above the chest, y at least 0.60 (least, m)", Math.min(...M.SIDES.map((sd) => pe.hand[sd][1])), 0.6, 5);
      c("end: the hands rest on the ribs, not held in the air: y at most 0.70, 0.15 above the chest at most (largest, m)", Math.max(...M.SIDES.map((sd) => pe.hand[sd][1])), 0.6, 0.7);
      c("end: the elbows hang 0.25 to 0.32 m from the midline, not out in a wing (largest, m)", Math.max(...M.SIDES.map((sd) => Math.abs(pe.elbow[sd][2]))), 0.2, 0.32);
      const lg = s.seg("let go")!;
      let pad = 9;
      for (let i = s.idx(lg.start); i < s.poses.length; i++) for (const sd of M.SIDES) for (const j of [s.poses[i].elbow[sd], s.poses[i].hand[sd]]) if (Math.abs(j[2]) < 0.15 && j[0] > -0.42 && j[0] < 0.8) pad = Math.min(pad, j[1] - 0.44 - 0.04);
      c("end: no hand or elbow inside the pad where they are over it (m)", pad, 0, 9);
    }
  return out;
}

function benchTouchGeometry(kind: "bench" | "bench-close"): Check[] {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), r2 = s.rep(2);
  const iR1 = s.idx(r1.start), iRL = s.idx(r2.end);
    const close = kind === "bench-close";
    const n = benchNumbers(kind as "bench" | "bench-close");
    const rt = M.repTiming(s, 1), fine = M.repTiming(s, 1, false, 0.001);
    // ---- the numbers that sit near the edge of a measured band are inside it with room
    c("upper arm to the plane that halves the body at the touch (deg), inside the measured band with a degree of room", n.abduction, close ? 31.7 : 52.1, close ? 44.1 : 72.1);
    c("bar travel (m), inside the measured band with room", n.travel, close ? 0.39 : 0.38, close ? 0.47 : 0.44);
    c("elbows ahead of the bar at the touch (m), off the edge of the band", n.lead, close ? 0.035 : 0.005, close ? 0.075 : 0.025);
    // ---- the bar at 1 kHz: no corner in the velocity at the touch (the 240 Hz suite could not see 22.6 m/s2 and 22.6k m/s3)
    {
      const k = barAt1kHz(kind, r1.start, r1.end);
      c("bar acceleration over rep 1 sampled at 1 kHz (m/s2)", k.accel, 0, 18);
      c("bar jerk over rep 1 sampled at 1 kHz (m/s3)", k.jerk, 0, 7500);
    }
    // ---- the ascent with margin: speeds, and the press by 1 mm bands
    {
      const bar = s.poses.map((p) => p.bar), bs = M.speedSeries(bar);
      const yBot = s.poses[rt.e1].bar[1], yTop = s.poses[rt.a].bar[1];
      let peak = 0, minMid = 9, minVy = 9;
      for (let i = rt.e1 + 1; i < rt.a; i++) {
        peak = Math.max(peak, bs[i]);
        const f = (s.poses[i].bar[1] - yBot) / (yTop - yBot);
        if (f >= 0.25 && f <= 0.8) { minMid = Math.min(minMid, bs[i]); minVy = Math.min(minVy, ((bar[i + 1][1] - bar[i - 1][1]) * M.HZ) / 2); }
      }
      c("bar peak speed up, inside its band (m/s)", peak, 0.6, close ? 0.76 : 0.73);
      c("least vertical speed between 25% and 80% of the ascent, off the 0.38 floor (m/s)", minVy, 0.4, 0.52);
      c("least 3D speed between 25% and 80% of the ascent, at most 0.8 of the peak (m/s)", minMid, 0.38, 0.8 * peak);
      c("press by 1 mm bands (s): the whole press; between 1 cm bands it reads 0.80, the close grip 0.87", fine.second, 0.8, close ? 1.01 : 0.96);
    }
    // ---- the arms against the drawn trunk: the close grip at the touch and mid-press, and the resting forearm
    {
      const tT = M.extremeTime(s, r1.start, r1.end, "min");
      const pe = s.poses[s.poses.length - 1];
      const a = M.armToDrawnTrunk(pe);
      c("end: the resting forearm to the drawn trunk (two hulls, as drawn), clear (m; against the two hulls as drawn, not one hull of shoulder balls to hips)", a.forearm, 0.02, 9);
      if (close) {
        let worst = 9;
        for (const dt of [0, 0.3, 0.6, 0.9]) { const p = set.pose(tT + dt); const g = M.armsToTrunkHull(p); worst = Math.min(worst, g.upper, g.forearm); }
        c("close grip: upper arm and forearm to the drawn upper-trunk hull at the touch and through the press (m)", worst, 0, 9);
      }
    }
    // ---- the hips: the seat ball sinks into the pad's give; the hip joints 0.19 apart (BODY.hipHalf 0.09 is 0.095 here, documented)
    {
      const p = s.poses[0];
      c("hip joints apart (m): 2 x 0.095, documented against BODY.hipHalf 0.09 so that the drawn thighs do not overlap", M.dist(p.hip.R, p.hip.L), 0.1899, 0.1901);
      c("the drawn seat ball (0.03 below the pelvis, radius 0.104) against the pad top, recorded (m; -0.0295: the reference pelvis 0.52-0.56 cannot lift it clear, 0.574 would)", p.pelvis[1] - 0.03 - 0.104 - 0.44, -0.032, 0);
    }
    void iR1; void iRL;
  return out;
}

/**
 * How the elbows travel between lockout and the chest, and the path the bar takes. The measurements and the coaching texts behind every
 * band are in docs/bench-press-elbows.md (its keys: [L21], [M22], [McL], [K17], [Nu16], [IPF26]); what is a judgement is said so there.
 */
function benchElbows(kind: "bench" | "bench-close"): Check[] {
  const close = kind === "bench-close";
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `${kind}: ${id}`, value, lo, hi, note: "" });
  const r1 = s.rep(1), rt = M.repTiming(s, 1);
  const iT = s.idx(M.extremeTime(s, r1.start, r1.end, "min"));
  const top = s.poses[rt.i0], chest = s.poses[iT];
  const yTop = top.bar[1], yBot = chest.bar[1], xTop = top.bar[0], xBot = chest.bar[0];
  /** The pose with the bar at share h of its rise above the chest, on the way down or up: between the two frames either side of that height. */
  const at = (h: number, way: "down" | "up") => {
    const y = yBot + (yTop - yBot) * h;
    const [a, b] = way === "down" ? [rt.i0, iT] : [iT, rt.i1];
    for (let i = a; i < b; i++) {
      const y0 = s.poses[i].bar[1], y1 = s.poses[i + 1].bar[1];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return set.pose(s.times[i] + ((y - y0) / (y1 - y0)) * (s.times[i + 1] - s.times[i]));
    }
    throw new Error(`${kind}: the bar never passes ${Math.round(h * 100)}% of its rise on the way ${way}`);
  };

  // ---- the elbows under the bar, seen from the side
  let ahead = -9, behind = 9, sideWorst = 0, leanSum = 0;
  for (let i = rt.i0; i <= rt.i1; i++) {
    const p = s.poses[i];
    ahead = Math.max(ahead, leadOf(p)); behind = Math.min(behind, leadOf(p));
    sideWorst = Math.max(sideWorst, ...M.SIDES.map((sd) => Math.abs(M.slope(p.elbow[sd], p.wrist[sd]))));
    leanSum += leanInOf(p);
  }
  c("elbows ahead of the bar seen from the side, most over the rep (m): the bar over the elbows (coaching); how far ahead is the judgement of the lead at the touch", ahead, 0, close ? 0.08 : 0.035);
  c("elbows behind the bar (toward the head) seen from the side, least lead over the rep (m): never", behind, -0.005, 1);
  c("forearm from the side over the rep (deg from upright, worst)", sideWorst, 0, close ? 22 : 8);
  // A judgement between two sources: [Nu16] has the elbows back under the bar by the midrange, [L21] saw the bar's moment arm about the elbow grow after the chest.
  c("elbows ahead of the bar half way up (m): at most 3 cm, the close grip 7 (a judgement)", leadOf(at(0.5, "up")), 0, close ? 0.07 : 0.03);
  {
    // The bar is nearer the head half way up than half way down; the elbows have followed half of that.
    const d = at(0.5, "down"), u = at(0.5, "up"), elbowX = (p: BenchNumbers["p"]) => M.both((sd) => p.elbow[sd][0]);
    c("share of the bar's early return toward the head that the elbows have followed, half way up: half (a judgement)", (elbowX(d) - elbowX(u)) / (d.bar[0] - u.bar[0]), 0.42, 0.58);
  }

  // ---- the flare: out at lockout, in toward the chest, and out again, without turning back
  let rise = 0, fall = 0;
  for (let i = rt.i0; i < iT; i++) rise += Math.max(0, flareOf(s.poses[i + 1]) - flareOf(s.poses[i]));
  for (let i = iT; i < rt.i1; i++) fall += Math.max(0, flareOf(s.poses[i]) - flareOf(s.poses[i + 1]));
  c("flare at lockout, seen from above (deg): the elbows point out to the sides [Nu16]", flareOf(top), 82, 98);
  c("flare on the way down: it only closes (sum of its rises, deg)", rise, 0, 0.5);
  c("flare on the way up: it only opens (sum of its falls, deg) [L21]", fall, 0, 0.5);
  const fDown = flareOf(at(0.5, "down")), fUp = flareOf(at(0.5, "up"));
  c("flare half way up minus half way down (deg): the elbows open as the bar is pressed back over the shoulders [Nu16]", fUp - fDown, 1, 8);
  c("flare half way up (deg): a judgement; open, but not rotated all the way out before lockout, the caution of [McL]", fUp, close ? 58 : 70, close ? 70 : 79.5);

  // ---- the elbow's bend and the forearm seen from the front
  // The elbow's bend on the way up, at the three moments it was read off lifters after the chest [L21]: 12%, about half and 92% of the rise.
  // The readings are off a chart, good to 2 degrees; the bands are 9 degrees either side of them, a judgement.
  const bend = (h: number) => M.both((sd) => M.elbowAngle(at(h, "up"), sd));
  c("elbow interior angle at the first peak of speed, 12% of the rise (deg): 61 to 71 medium to wide, 58 narrow [L21]", bend(0.12), close ? 46 : 55, close ? 64 : 75);
  c("elbow interior angle at the end of the sticking region (deg): 86 to 88 at 46 to 55% of the rise [L21]", bend(close ? 0.55 : 0.48), 78, 94);
  c("elbow interior angle at 92% of the rise (deg): 133 to 135 [L21]", bend(0.92), 126, 146);
  // A judgement, not a target reached: the measured mean over a rep is 0.8 leaning in (medium), 12.5 leaning out (wide) and 8.5 to 16.5 leaning in
  // (narrow) [M22]. A two-bone arm whose hand is over its shoulder has its elbow 0.2 m off the line between them at mid-height, so it leans more.
  c("forearm leaning in seen from the front, mean over the rep (deg): more than the measured means, see docs/lift-motion.md", leanSum / (rt.i1 - rt.i0 + 1), close ? 18 : 2, close ? 32 : 12);

  // ---- the bar's path: down along a line that drifts early, up toward the head from the first centimetres
  const share = (p: BenchNumbers["p"]) => (p.bar[0] - xTop) / (xBot - xTop);
  // The lowering path is "concave toward the head" [McL]; by how much is a judgement, nobody gives the bar's place half way down.
  c("share of the sideways travel done half way down: the bar drifts toward the feet early (the amount a judgement)", share(at(0.5, "down")), 0.55, 0.62);
  // 0.57 is arithmetic on the table of [L21] (0.131 m at the chest, 0.056 half way up); skilled lifters are further back by then [McL]. A judgement between them.
  c("share of the way back done half way up: toward the head off the chest, 0.57 measured on trained lifters [L21], skilled ones more [McL]", 1 - share(at(0.5, "up")), 0.62, 0.7);
  const chord = (a: BenchNumbers["p"], b: BenchNumbers["p"]) => M.deg(Math.atan2(b.bar[1] - a.bar[1], Math.abs(b.bar[0] - a.bar[0])));
  c("the bar leaves the chest at (deg to the horizontal, chest to 12% of the rise): 60.3 skilled, 84.4 novice [McL]", chord(chest, at(0.12, "up")), 55, 64);
  // Steeper than the 66 to 72 of [McL]: this bar rises 0.40 m for 0.14 m of way back, and the angles of a shorter rise cannot all be kept.
  c("the bar's last half of the rise (deg to the horizontal): still toward the head, not straight up; steeper than the 66 to 72 of [McL]", chord(at(0.5, "up"), set.pose(s.times[rt.i1])), 70, 80);
  let toFeet = 0, toHead = 0;
  for (let i = iT; i < rt.i1; i++) toFeet = Math.max(toFeet, s.poses[i + 1].bar[0] - s.poses[i].bar[0]);
  for (let i = rt.i0; i < iT; i++) toHead = Math.max(toHead, s.poses[i].bar[0] - s.poses[i + 1].bar[0]);
  c("the bar never moves toward the feet on the way up (largest step, m)", toFeet, 0, 1e-5);
  c("the bar never moves toward the head on the way down (largest step, m)", toHead, 0, 1e-5);
  // medium grip for the bench, narrow for the close grip (which touches lower here than those lifters did)
  for (const [h, x] of (close ? [[0.13, 0.123], [0.55, 0.062], [0.92, -0.009]] : [[0.1, 0.121], [0.5, 0.056], [0.92, -0.01]]) as ReadonlyArray<readonly [number, number]>) {
    c(`bar from its lockout position at ${Math.round(h * 100)}% of the rise (m): ${x} +/- 0.035 [L21]`, at(h, "up").bar[0] - xTop, x - 0.035, x + 0.035);
  }

  // ---- the set-up: the shoulders pinned back and the chest up
  // That the shoulder blades are pulled together and pressed into the pad is [Ri11] and [Nu16]; neither gives a distance. 4.5 cm is the judgement that makes the bar's travel the measured one.
  c("shoulder joints below the chest point (m): a judgement; the shoulder blades are pulled together and pressed into the pad", top.chest[1] - top.shoulder.R[1], 0.03, 0.06);
  c("the drawn shoulders against the pad top (m): resting on it, a little into its give", top.shoulder.R[1] - 0.072 - PAD, -0.012, 0.005);
  {
    const T = M.drawnTorso(top), ribs = T.upper[0], ball = T.upper[3];
    const dx = ribs[0][0] - ball[0][0], dy = ribs[0][1] - ball[0][1];
    // Above every measured mean, inside the spread of the widest grip's.
    c("the arch: the drawn breastbone against the horizontal (deg): 25.8 +/- 4.8 (narrow) to 32.3 +/- 5.5 (wide) [M22]", M.deg(Math.atan2(dy, dx) + Math.asin((ribs[1] - ball[1]) / Math.hypot(dx, dy))), 21, 37.8);
  }
  return out;
}

/** Every check of one bench lift. */
export const benchSuite = (kind: "bench" | "bench-close"): Check[] => [...benchChecks(kind), ...benchContact(kind), ...benchTrunkAndLockout(kind), ...benchTouchGeometry(kind), ...benchElbows(kind)];
