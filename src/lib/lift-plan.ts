// The stage of each lift, planned from the lifts alone (one rep, every pose each set reaches, the biggest plates the bar can
// carry): it does not change with the load, the reps or the time, and all the lifts share one stage size and one scale, so
// that nothing on the page moves when the lift changes. The plans are computed ahead of time (`npm run lift:plans`) and
// stored in `lift-plans.ts`: the page reads them instead of building six sets and sampling 240 poses of each on its first
// frame. A test computes them again and compares.

import { makeLiftSet } from "./lift-motion";
import { planStages, type StagePlan, type StageSize } from "./lift-camera";
import { samplePoses } from "./lift-set";
import { LIFT_KINDS, type LiftKind } from "./lifts";
import { PLANS } from "./lift-plans";

export type Plans = Record<StageSize, Record<LiftKind, StagePlan>>;

/** The stage of a lift at a size: the stored plan. */
export function stageFor(kind: LiftKind, size: StageSize): StagePlan {
  return PLANS[size][kind];
}

/** Plans every lift at both sizes from the motion model. Takes a few hundred milliseconds: build time and tests only. */
export function computePlans(): Plans {
  const lifts = LIFT_KINDS.map((kind) => ({ kind, samples: samplePoses(makeLiftSet(kind, { reps: 1 }), 240) }));
  return { wide: planStages("wide", lifts), narrow: planStages("narrow", lifts) };
}
