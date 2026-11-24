// What the page needs from a motion model: for one set, its timeline and its pose at any time.
// The model that returns this is `lift-motion.ts` (`makeLiftSet`).

import type { LiftKind } from "./lifts";
import type { LiftPose, LiftScene } from "./lift-pose";

export type Segment = { name: string; start: number; end: number };

/** Where a set stands at an instant: the rep under way (1-based, 0 between reps and outside them) and how many reps are finished. */
export type RepCount = { rep: number; done: number };

export type LiftSet = {
  kind: LiftKind;
  /** The reps of the set, 1 to 30. */
  reps: number;
  /** Seconds, approach or unrack included, ending included. */
  duration: number;
  /** The time of the most telling still of the set. */
  heroTime: number;
  /** One segment per rep named "rep 1", "rep 2", ..., and the segments around them. */
  timeline: readonly Segment[];
  scene: LiftScene;
  pose(t: number): LiftPose;
  /** A quiet word for what happens at t: "pull", "walkout". */
  phase(t: number): string;
  /** The rep under way at t and how many are finished (a binary search over the reps). */
  repAt(t: number): RepCount;
};

/** The rep segments of a timeline, in order. */
export const repSegments = (timeline: readonly Segment[]): Segment[] => timeline.filter((segment) => /^rep \d+$/.test(segment.name));

/** A set's `repAt`, from the rep segments (contiguous, in order): a binary search for the first rep that has not ended. */
export function makeRepAt(timeline: readonly Segment[]): (t: number) => RepCount {
  const reps = repSegments(timeline);
  return (t) => {
    let lo = 0, hi = reps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t >= reps[mid].end) lo = mid + 1; else hi = mid; }
    return { rep: lo < reps.length && t >= reps[lo].start ? lo + 1 : 0, done: lo };
  };
}

/** Poses spread over the whole timeline, to plan a stage from. `working` marks those during the reps, when the feet are planted at the bar. */
export function samplePoses(set: LiftSet, count = 160): Array<{ pose: LiftPose; scene: LiftScene; working: boolean }> {
  const reps = repSegments(set.timeline);
  const from = reps.length ? Math.min(...reps.map((segment) => segment.start)) : 0;
  const to = reps.length ? Math.max(...reps.map((segment) => segment.end)) : set.duration;
  const out: Array<{ pose: LiftPose; scene: LiftScene; working: boolean }> = [];
  for (let i = 0; i < count; i++) {
    const t = (set.duration * i) / (count - 1);
    out.push({ pose: set.pose(t), scene: set.scene, working: t >= from && t <= to });
  }
  return out;
}
