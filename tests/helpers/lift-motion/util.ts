// Small helpers the check files share.
import * as M from "./measure";
import type { LiftKind } from "../../../src/lib/lifts";
import { getSet } from "./check";

export const maxOver = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);
export const minOver = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);
export const shankOf = (p: ReturnType<M.Sampled["set"]["pose"]>) => M.both((sd) => M.slope(p.ankle[sd], p.knee[sd]));
export const kneePastToe = (p: ReturnType<M.Sampled["set"]["pose"]>) => M.both((sd) => p.knee[sd][0] - p.toe[sd][0]);
/** The gap between the bar and the drawn upper trunk, the worst along the bar, sampled coarsely (a frame costs a few hundred hull queries). */
export const barToHull = (p: ReturnType<M.Sampled["set"]["pose"]>) => {
  const T = M.drawnTorso(p);
  let m = 9;
  for (let z = -0.5; z <= 0.5001; z += 0.125) m = Math.min(m, M.hullSigned([p.bar[0], p.bar[1], z], T.upper) - M.RAD.bar);
  return m;
};

/** Sampled at 1 kHz over [t0, t1]: the largest |acceleration| and jerk of the bar. */
export function barAt1kHz(kind: LiftKind, t0: number, t1: number) {
  const set = getSet(kind, 2);
  const HZ = 1000, N = Math.round((t1 - t0) * HZ);
  const bar = Array.from({ length: N + 1 }, (_, i) => set.pose(t0 + i / HZ).bar);
  let a = 0, j = 0;
  for (let i = 3; i < N - 3; i++) {
    a = Math.max(a, M.len(M.add(M.sub(bar[i + 1], M.mul(bar[i], 2)), bar[i - 1])) * HZ * HZ);
    j = Math.max(j, M.len(M.sub(M.add(M.sub(bar[i + 2], M.mul(bar[i + 1], 3)), M.mul(bar[i], 3)), bar[i - 1])) * HZ * HZ * HZ);
  }
  return { accel: a, jerk: j };
}
