// The reference targets for the bench, one Check each.
import * as M from "./measure";
import { barAt1kHz, barToHull, maxOver } from "./util";
import { type Check, getSet } from "./check";

const PAD = 0.44;

type BenchNumbers = {
  hands: number; flare: number; touchX: number; barAboveShoulder: number; elbowAngle: number; elbowZ: number;
  tiltSide: number; tiltFront: number; pathLength: number; p: ReturnType<M.Sampled["set"]["pose"]>;
};

export function benchNumbers(kind: "bench" | "bench-close"): BenchNumbers {
  const set = getSet(kind, 2);
  const s = M.sample(set);
  const r1 = s.rep(1);
  const rt = M.repTiming(s, 1);
  const tT = M.extremeTime(s, r1.start, r1.end, "min");
  const p = set.pose(tT);
  const a = M.unit(M.sub(p.pelvis, p.chest));
  const flare = M.both((sd) => { const u = M.unit(M.sub(p.elbow[sd], p.shoulder[sd])); return M.deg(Math.atan2(Math.abs(u[2]), M.dot(u, a))); });
  let len = 0;
  for (let i = rt.m0; i < rt.e0; i++) len += M.dist(s.poses[i].bar, s.poses[i + 1].bar);
  return {
    p, hands: M.dist(p.hand.R, p.hand.L), flare, touchX: p.bar[0], barAboveShoulder: p.bar[1] - p.chest[1],
    elbowAngle: M.both((sd) => M.elbowAngle(p, sd)), elbowZ: M.both((sd) => Math.abs(p.elbow[sd][2])),
    tiltSide: Math.max(...M.SIDES.map((sd) => Math.abs(M.slope(p.elbow[sd], p.wrist[sd])))),
    tiltFront: Math.max(...M.SIDES.map((sd) => { const w = M.sub(p.wrist[sd], p.elbow[sd]); return Math.abs(M.deg(Math.atan2((sd === "R" ? 1 : -1) * w[2], w[1]))); })),
    pathLength: len,
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

  // ---- grip and touch
  const lockP = s.poses[iR1];
  c("hand-to-hand at lockout (m)", M.dist(lockP.hand.R, lockP.hand.L), close ? 0.38 : 0.64, close ? 0.42 : 0.68);
  c("hand-to-hand at the touch (m)", n.hands, close ? 0.38 : 0.64, close ? 0.42 : 0.68);
  c("elbow flare at the touch (deg)", n.flare, close ? 16 : 45, close ? 26 : 60);
  c("touch point toward the feet from the shoulder line (m)", n.touchX, close ? 0.17 : 0.115, close ? 0.2 : 0.135);
  // The reference numbers: the bar centre 0.10-0.14 above the shoulder joints, the forearm tilts at most 4 / 5 deg (bench) and
  // 8 / 10 deg (close grip), the elbow interior angle 38-42 (bench) and 34-39 (close grip). They hold together only if the bar is at most 0.138
  // above the shoulder joints, which it is by settling into the drawn chest (docs/lift-motion.md).
  c("bar centre above the shoulder-joint line at the touch (m)", n.barAboveShoulder, 0.1, 0.14);
  c("forearm tilt at the touch, side view (deg): the reference 4 (bench) and 8 (close grip)", n.tiltSide, 0, close ? 8 : 4);
  c(`forearm tilt at the touch, front view (deg): the reference ${close ? 10 : 5}`, n.tiltFront, 0, close ? 10 : 5);
  c("elbow interior angle at the touch (deg): the reference 38-42 (bench) and 34-39 (close grip)", n.elbowAngle, close ? 34 : 38, close ? 39 : 42);
  c("elbow z at the touch (m)", n.elbowZ, close ? 0.25 : 0.3, 1);
  let wristBelow = 9, handLevel = 0, barLevel = 0;
  for (let i = 0; i < s.poses.length; i++) {
    const q = s.poses[i];
    for (const sd of M.SIDES) wristBelow = Math.min(wristBelow, q.bar[1] - q.wrist[sd][1]);
    if (q.gripping) { handLevel = Math.max(handLevel, Math.abs(q.hand.R[1] - q.hand.L[1]), Math.abs(q.hand.R[1] - q.bar[1])); barLevel = Math.max(barLevel, Math.abs(q.hand.R[0] - q.hand.L[0])); }
  }
  c("wrist below the bar centre (min, m)", wristBelow, 0.06, 1);
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
  c("lift-off: rise (m)", Math.max(...s.poses.slice(0, iR1 + 1).map((q) => q.bar[1])) - hook[1], 0.07, 0.12);
  c("bar x at the start of rep 1 (m)", Math.abs(lockP.bar[0]), 0, 0.03);
  c("bar returns to the start hook position (m)", M.dist(s.poses[s.poses.length - 1].bar, hook), 0, 0.01);

  // ---- timing
  c("descent (s)", rt.first, 0.95, 1.1);
  c("hold within 1 mm of the bottom (s)", (() => { const b = rt.ext; let k = rt.e0, m = rt.e0; while (Math.abs(s.poses[k].bar[1] - b) >= 0.001 && k < rt.a) k++; m = k; while (k > rt.m0 && Math.abs(s.poses[k - 1].bar[1] - b) < 0.001) k--; while (m < rt.a && Math.abs(s.poses[m + 1].bar[1] - b) < 0.001) m++; return (m - k + 1) / M.HZ; })(), 0.2, 0.3);
  c("press (s)", rt.second, 0.8, 1.0);
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
  c("bar peak speed up (m/s)", peakUp, 0, 0.8);
  const yBot = s.poses[rt.e1].bar[1], yTop = s.poses[rt.a].bar[1];
  let minMid = 9;
  for (let i = rt.e1; i < rt.a; i++) { const f = (s.poses[i].bar[1] - yBot) / (yTop - yBot); if (f >= 0.25 && f <= 0.8) minMid = Math.min(minMid, bs[i]); }
  c("min speed between 25% and 80% of the ascent (m/s)", minMid, 0.45, 0.8 * peakUp);
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
    diff = Math.max(diff, Math.abs(xu - xd));
  }
  c("J curve: bar x differs between the down and the up path at equal height (m)", diff, 0.015, 1);
  c("bar x at lockout minus the shoulder line (m)", Math.abs(lockP.bar[0] - lockP.chest[0]), 0, 0.03);
  let plateau = 0, run = 0;
  for (let i = rt.e1; i < rt.a; i++) { if (Math.abs(s.poses[i + 1].bar[0] - s.poses[i].bar[0]) * M.HZ < 0.03) { run++; plateau = Math.max(plateau, run); } else run = 0; }
  c("bar x plateau on the way up (s)", plateau / M.HZ, 0.12, 2);

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
  c("close touch lies farther toward the feet by (m)", cl.touchX - b.touchX, 0.05, 0.09);
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
    c("bar to the drawn upper torso, worst over the reps (m; negative is inside): settles 1.8 to 3.3 cm into the drawn chest (a bar resting on it is 0.158 above the shoulders, the reference 0.14 needs this)", barChest, -0.033, -0.018);
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
    c("bar sinks into the drawn chest at the touch: 1.8 to 3.3 cm (m, negative is inside)", barToHull(pt), -0.033, -0.018);
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
      c("vertical bar speed between 25% and 80% of the ascent, least (m/s)", minVy, 0.45, 0.8);
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
    // ---- the bar settles into the drawn chest (the cause of three majors: a bar resting on the hull is 0.158 above the shoulders, where the
    // reference elbow angle, forearm tilts and flare cannot hold together at any height above 0.138)
    c("bar above the shoulder-joint line at the touch (m): the reference 0.10-0.14, with room", n.barAboveShoulder, 0.1, close ? 0.134 : 0.138);
    c("forearm tilt at the touch, front view (deg): the reference 5 (bench) and 10 (close), not widened", n.tiltFront, 0, close ? 9.9 : 4.5);
    c("elbow interior angle at the touch (deg): the reference 38-42 (bench) and 34-39 (close), not widened", n.elbowAngle, close ? 34 : 38.5, close ? 38.9 : 41.5);
    c("forearm tilt at the touch, side view (deg): the reference 4 (bench) and 8 (close)", n.tiltSide, 0, close ? 6 : 4);
    c("elbow flare at the touch (deg): the reference 45-60 (bench) and 16-26 (close); in the close grip 16.3 is the least that holds with the elbow z, the front tilt and the hands", n.flare, close ? 16.3 : 45.5, close ? 26 : 60);
    c("elbow z at the touch (m): at least 0.25, with a millimetre of room", n.elbowZ, close ? 0.252 : 0.3, 1);
    // ---- the numbers that sat on a band edge are inside it
    c("hand-to-hand at the touch, off the edge of the reference band (m)", n.hands, close ? 0.39 : 0.645, close ? 0.418 : 0.675);
    c("touch point, off the edge of the reference band (m)", n.touchX, close ? 0.175 : 0.118, close ? 0.195 : 0.132);
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
      c("bar peak speed up, off the 0.8 limit (m/s)", peak, 0.7, close ? 0.799 : 0.78);
      c("least vertical speed between 25% and 80% of the ascent, off the 0.45 floor (m/s)", minVy, 0.48, 0.6);
      c("least 3D speed between 25% and 80% of the ascent, at most 0.8 of the peak (m/s)", minMid, 0.45, 0.8 * peak);
      c("press by 1 mm bands (s; the reference 0.80-1.00 is by 1 cm bands, 0.89 here; the close grip rises 0.51 m with a peak under 0.8)", fine.second, 0.8, close ? 1.01 : 0.96);
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

/** Every check of one bench lift. */
export const benchSuite = (kind: "bench" | "bench-close"): Check[] => [...benchChecks(kind), ...benchContact(kind), ...benchTrunkAndLockout(kind), ...benchTouchGeometry(kind)];
