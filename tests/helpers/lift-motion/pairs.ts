// The checks that compare two lifts: low bar against high bar, bench against close grip, conventional against sumo.
import * as M from "./measure";
import { type Check, getSet } from "./check";
import type { LiftKind } from "../../../src/lib/lifts";
import { benchNumbers, benchPairChecks } from "./bench";
import { deadPairChecks } from "./deadlift";
import { lowHighChecks } from "./squat";

function otherPairs(): Check[] {
  const out: Check[] = [];
  const c = (id: string, value: number, lo: number, hi: number) => out.push({ id: `pair: ${id}`, value, lo, hi, note: "" });
  const a = M.sample(getSet("deadlift-conventional", 2)), b = M.sample(getSet("deadlift-sumo", 2));
  const pa = a.poses[a.poses.length - 1], pb = b.poses[b.poses.length - 1];
  c("deadlifts end alike: knee angle differs by (deg)", Math.abs(M.both((sd) => M.kneeAngle(pa, sd)) - M.both((sd) => M.kneeAngle(pb, sd))), 0, 0.5);
  c("deadlifts end alike: elbow angle differs by (deg)", Math.abs(M.both((sd) => M.elbowAngle(pa, sd)) - M.both((sd) => M.elbowAngle(pb, sd))), 0, 0.5);
  c("deadlifts start alike: knee angle differs by (deg)", Math.abs(M.both((sd) => M.kneeAngle(a.poses[0], sd)) - M.both((sd) => M.kneeAngle(b.poses[0], sd))), 0, 0.5);
  const tbl = (k: LiftKind) => M.sample(getSet(k, 2));
  const bs = tbl("bench"), bc = tbl("bench-close");
  const rt = (x: ReturnType<typeof tbl>) => M.repTiming(x, 1).rep;
  c("close-grip rep is longer than the bench rep by (s); centred", rt(bc) - rt(bs), 0.1, 0.2);
  const bottom = (kind: "squat-low" | "squat-high") => { const set = getSet(kind, 2), s = M.sample(set), r1 = s.rep(1); return set.pose(M.extremeTime(s, r1.start, r1.end, "min")); };
  const lo = bottom("squat-low"), hi = bottom("squat-high");
  c("the low-bar stance is wider than the high-bar stance by (m)", M.dist(lo.heel.R, lo.heel.L) - M.dist(hi.heel.R, hi.heel.L), 0.035, 0.07);
  const bn = benchNumbers("bench"), cl = benchNumbers("bench-close");
  c("close elbow angle at the touch is under the bench's (deg)", cl.elbowAngle - bn.elbowAngle, -20, -1);
  return out;
}

/** Every check that compares two lifts. */
export const pairChecks = (): Check[] => [...lowHighChecks(), ...benchPairChecks(), ...deadPairChecks(), ...otherPairs()];
