// The numbers behind the six lifts: one table per family, one row per lift kind. The planners in `lift-motion.ts` turn a row into a
// script. Exported as plain mutable objects so that the tests can break a number on purpose and see the suite notice; nothing else
// changes them.

import { BODY } from "./lift-pose";
import { DEG, unit, type V } from "./lift-math";

/** How a bar move begins or ends: `a`, a constant acceleration (m/s2) from or to rest, or `w`, a quintic ramp over that share of the move. */
export type MoveEnd = { a?: number; w?: number };

export type SquatCfg = {
  stance: number; toeOut: number; grip: number;
  /** Shank angle from vertical at the bottom, and hip minus knee height there. */
  shankB: number; depth: number;
  /** Where the bar sits on the torso: above the shoulder line along the thorax, and behind the torso axis. */
  barUp: number; barBack: number;
  lumbarK: number; headK: number; headOff: number;
  /** Torso angle standing under the load. */
  thStand: number;
  /** Knee lateral position: standing (relative to the midpoint of hip and ankle) and at the bottom (outside the ankle). */
  kneeTop: number; kneeOutB: number;
  /** The shank and the thigh turn from their standing angles to their bottom angles as the depth parameter to these powers (the shank never back, the thigh slowly at first). */
  shankPow: number; thighPow: number;
  /**
   * Where the elbows are pointed while gripping: the pole of the arm solve, as a share along the torso (up) and away from the back
   * (back), and sideways (z, outward). In a squat the elbows are under the bar, so `up` is negative for both: the low bar's point
   * back and down beside the ribs, the high bar's down and out.
   */
  pole: { up: number; back: number; z: number };
  /** Rep tempo, seconds. */
  lead: number; down: number; pause: number; up: number; lockout: number;
};

export const SQUAT: Record<"squat-low" | "squat-high", SquatCfg> = {
  "squat-low": {
    stance: 0.238, toeOut: 29 * DEG, grip: 0.72, shankB: 26.3 * DEG, depth: -0.04, barUp: -0.052, barBack: 0.126,
    lumbarK: 1.0, headK: 0.25, headOff: 0.05, thStand: 0.2, kneeTop: 0.01, kneeOutB: 0.075, shankPow: 2, thighPow: 2.5, pole: { up: -1, back: 0.4, z: 0.5 },
    lead: 0.005, down: 1.24, pause: 0.0837, up: 1.3129, lockout: 0.1666,
  },
  "squat-high": {
    stance: 0.21, toeOut: 22.5 * DEG, grip: 0.585, shankB: 37.5 * DEG, depth: -0.04, barUp: 0.02, barBack: 0.108,
    lumbarK: 0.95, headK: 0.3, headOff: 0.05, thStand: 0.17, kneeTop: 0.01, kneeOutB: 0.08, shankPow: 2, thighPow: 2.5, pole: { up: -1, back: 0.6, z: 1.3 },
    lead: 0.005, down: 1.24, pause: 0.0837, up: 1.3129, lockout: 0.1666,
  },
};

export const SQ = {
  /** The bar rides this far ahead of the ankle joints: over the midfoot. */
  midfoot: 0.07,
  /** The bar rests in the hooks this far below its standing height. */
  rackDrop: 0.07,
  /** Walking the bar out: total travel and the length of each step (R, L, R). */
  walk: [0.24, 0.46, 0.22] as const,
  stepDur: [0.5, 0.55, 0.5] as const,
  gap: 0.11,
  sway: 0.025,
  stepLift: 0.07,
  outLength: 0.3,
  /**
   * The bar's speed shapes (m/s control points on 0..1 of the move, and how each end of the move is eased). The descent is a
   * steady lowering that slows over its last third and comes to rest with zero acceleration (no braking jolt: at most about
   * 5 m/s2, where a bar stopped over 40 ms needs 11). The ascent leaves the bottom over 0.2 s (a first hump of about 0.6 m/s
   * at 0.2 s), slows in the sticking region and gathers a lower second hump before it finishes gently.
   */
  descent: { start: { w: 0.25 } as MoveEnd, end: {} as MoveEnd, base: [[0, 0.6], [0.3, 0.65], [0.55, 0.62], [0.78, 0.5], [0.9, 0.3], [1, 0]] as ReadonlyArray<readonly [number, number]> },
  ascent: { start: { w: 0.135 } as MoveEnd, end: { w: 0.2212 } as MoveEnd, base: [[0, 0.6994], [0.08, 0.4656], [0.4, 0.361], [0.72, 0.4318], [0.9, 0.4404], [1, 0.3076]] as ReadonlyArray<readonly [number, number]> },
  /** How straight the legs are standing under the bar, as a share of their length, and the most they may stretch while stepping. */
  standReach: 0.9984,
  maxReach: 0.9993,
  walkReach: 0.9945,
  reachSoft: 0.008,
  /** The most the lifter sinks (m) when the feet are far apart. */
  sink: 0.015,
  /** Duration of the release: the arms drop and the lifter stands up. */
  /** How far outside the shoulder the hands hang (m): clear of the thighs by a mitt and a forearm. */
  hangOut: 0.15,
  /** Where the elbows point while the arms hang (the pole of the arm solve, sideways): out far enough for the upper arm to clear the drawn ribs. */
  hangPole: 1.5,
  /** How far the forearms swing in toward the plane of the body as the hands drop from the bar. */
  rise: { from: 0.27, dur: 0.64 },
  /** The elbow leads the hand in the release (the elbow's share of the move runs this far ahead), and the elbow swings out from the body's plane by this much as the arm drops. */
  release: { elbowLead: 0, elbowOut: 0, psiPull: 0, elbowBack: 0.3, speed: [[0, 0], [0.12, 1], [0.88, 1], [1, 0]] as ReadonlyArray<readonly [number, number]> },
  letGo: 1.3,
  settle: 0.7,
};

export type BenchCfg = {
  /** Half the distance between the hands, touch point toward the feet from the shoulder line. */
  grip: number; touch: number;
  /** The swivel of the elbow about the shoulder-wrist axis (rad, 0 = straight out from the body, positive toward the feet along the axis cross product), the same for the whole lift: a pole vector would point straight against the axis near lockout and the elbow would flip. */
  swivel: number;
  /** How much further the swivel turns (rad) as the bar leaves the chest: the elbows come out a little once the bar is up, over the first `swivelSpan` of the press, so that the arm clears the drawn ribs while the forearms are upright at the touch. */
  swivelUp: number; swivelSpan: number;
  /** Rep tempo: descent, touch, press, lockout. */
  down: number; hold: number; up: number; lockout: number;
  /** How far the bar's surface sinks into the outline of the drawn chest (m), measured along the normal of the outline: the bar rests on the chest, a couple of millimetres in. */
  sink: number;
  /** How much of the descent is its soft landing: the speed falls to zero over this share of the move as a quintic, so that the bar stops with no leftover speed, no acceleration and no jerk (a corner in the velocity is visible at 1 kHz as a hit). */
  downTail: number;
  /** The speed of the bar going up, as control points (share of the press, relative speed): leaves the chest fast, slows through the sticking region, finishes gently. */
  upSpeed: ReadonlyArray<readonly [number, number]>;
  /** How the press slows into lockout: over this share of the move the speed falls to `upFloor` of its shape (the elbows turn a small change of height into a large change of angle near straight). */
  upTail: number; upFloor: number;
  /** How far the bar has travelled toward its x as a function of the share of its height still to go: where the sweep starts and how wide it is (descent, ascent). Down and up differ: a J curve. */
  xDown: readonly [number, number]; xUp: readonly [number, number];
};

export const BENCH: Record<"bench" | "bench-close", BenchCfg> = {
  bench: { grip: 0.335, touch: 0.13, swivel: 1.295, swivelUp: 0, swivelSpan: 0.3, down: 1.2188, hold: 0.0999, up: 1.0513, lockout: 0.3059, sink: 0.0283, downTail: 0.1276, upTail: 0.2013, upFloor: 0.1507, upSpeed: [[0, 0], [0.0989, 0.2187], [0.2498, 1.1072], [0.5282, 0.7615], [0.7795, 1.0338], [0.9297, 0.6596], [1, 0]], xDown: [0.12, 0.88], xUp: [0, 0.75] },
  "bench-close": { grip: 0.208, touch: 0.185, swivel: 1.385, swivelUp: -0.25, swivelSpan: 0.3, down: 1.2347, hold: 0.1193, up: 1.099, lockout: 0.3324, sink: 0.0236, downTail: 0.1019, upTail: 0.21, upFloor: 0.1602, upSpeed: [[0, 0], [0.1173, 0.2389], [0.2845, 0.9692], [0.5276, 0.6337], [0.8202, 0.8535], [0.9333, 0.7213], [1, 0]], xDown: [0, 1], xUp: [0, 0.75] },
};

export const PAD = 0.44;
export const BN = {
  /** Shoulder joints (the chest point) and pelvis in the sagittal plane; the waist falls out of the spine lengths. */
  S: [0, PAD + 0.1095] as const, P: [0.4925, PAD + 0.1045] as const,
  headDist: 0.2, headY: PAD + BODY.headRadius + 0.005,
  feetZ: 0.29, toeOut: 12 * DEG, kneeZ: 0.3, ankleBehindKnee: 0.04,
  hookX: -0.185, hookY: 1.09, rackHalf: 0.56,
  /** Where the hands come to rest after the bar is racked (the left hand mirrored), and where the elbows are pointed on the way there: the hands rest on the ribs beside the chest, the elbows hang down over the edge of the pad. */
  restHand: [0.3, 0.66, 0.22] as V, restVec: unit([0.3, 1, 0]) as V, restPole: [0.5, -1.5, 0.5] as V,
  armMax: 0.5792,
  /** The bar at lockout is this far below the highest the arms can put it at that x (m): the elbows end at about 170 degrees, not straight. */
  lockMargin: 0.0003,
  handVec: unit([-0.05, 1, 0]) as V,
};

export type DeadliftCfg = {
  /** Ankle z, toe-out, half the distance between the hands, knee z outside the ankle. */
  stance: number; toeOut: number; grip: number; kneeOut: number;
  /** Bar ahead of the ankle joints. */
  barAhead: number;
  /** Interior knee angle at lift-off (rad); back angle above horizontal at lockout (rad); shoulder x relative to the bar at lift-off and at lockout. */
  kneeStart: number; alphaLock: number; dxs0: number; dxsLock: number;
  /**
   * How the knees extend with the bar's progress p (0 floor, 1 lockout): up, 1 - (1 - p)^upExp; down, the knees stay
   * extended (the hips go back first) until the bar passes `downHold`, then bend: 1 - (1 - p / downHold)^downExp.
   */
  upExp: number; downExp: number; downHold: number;
  /** Tension taken out of the slack: the knees this many radians straighter and the shoulders this far forward before it is taken. */
  slackKnee: number; slackDxs: number;
  headK: number;
  wide: boolean;
  /** Where the free hands hang, outside the shoulders, and how much further out they go as the feet go wide (so that a wide-stepping thigh does not sweep through an arm). */
  handOut: number; handOutWide: number; handSwing: number;
  /** How far forward of vertical the free arms hang (rad): clear of a splayed thigh. */
  handFwd: number;
  /** Distance walked from the first frame to the bar (m), counted from the final position of the feet. */
  approach: number;
  tempo: { lead: number; pull: number; hold: number; lower: number; floor: number };
  /** The speed shapes (relative): how fast the pull leaves the floor (the first node; the slower, the softer the start) and the middle of the lowering (its fastest point). */
  pullStart: number; lowerPeak: number;
};

export const DEADLIFT: Record<"deadlift-conventional" | "deadlift-sumo", DeadliftCfg> = {
  "deadlift-conventional": {
    stance: 0.125, toeOut: 8 * DEG, grip: 0.255, kneeOut: 0.005, barAhead: 0.13,
    kneeStart: 92 * DEG, alphaLock: 89 * DEG, dxs0: 0.02, dxsLock: -0.089, upExp: 1.3, downExp: 1.9, downHold: 0.72,
    slackKnee: 4 * DEG, slackDxs: 0.025, headK: 0.55, wide: false, handOut: 0.085, handOutWide: 0, handSwing: 0.07, handFwd: 0.05, approach: 0.9,
    tempo: { lead: 0.103, pull: 1.63, hold: 0.31, lower: 1.22, floor: 0.31 }, pullStart: 0.27, lowerPeak: 0.74,
  },
  "deadlift-sumo": {
    stance: 0.45, toeOut: 44 * DEG, grip: 0.205, kneeOut: 0.015, barAhead: 0.09,
    kneeStart: 79 * DEG, alphaLock: 89 * DEG, dxs0: 0.02, dxsLock: -0.132, upExp: 0.9, downExp: 1.6, downHold: 0.8,
    slackKnee: 4 * DEG, slackDxs: 0.025, headK: 0.6, wide: true, handOut: 0.07, handOutWide: 0.14, handSwing: 0, handFwd: 0.2, approach: 0.84,
    tempo: { lead: 0.094, pull: 1.68, hold: 0.29, lower: 1.18, floor: 0.29 }, pullStart: 0.3, lowerPeak: 0.78,
  },
};

export const DL = {
  /** Bending to the bar and standing up again: the head never moves faster than the bar did in the pull. */
  hinge: 1.35, letGo: 1.6, standTall: 0.4,
  /** How far the bar has risen (m) at the most telling still of a deadlift: about the height of the knee. */
  heroRise: 0.27,
  /** Height of the bar's centre on the floor: the radius of a 25 kg plate. */
  barY: 0.225,
  /** Longest hip-to-ankle distance the pull allows: the knee is never straighter than about 174 degrees. */
  reach: 0.86 * Math.sin(87 * DEG),
  /** Shoulder to wrist with the arm straight: 175 degrees at the elbow. */
  arm: 0.5797,
  /** A free arm hangs at the full reach of the arm: where the hand goes for the bar the arm only stretches no further (the reach limit of the arm solve), so that it never snaps straight and stops dead. */
  armFree: 0.5797,
  walkStance: 0.1,
  /** The approach: duration of each step and the pause between steps (s), the same for every step of both lifts. */
  stepDur: 0.52, stepGap: 0.03,
  /** The last two steps of a sumo approach (the foot goes out to the wide stance) take this many times a normal step: the swing of a wide, turned-out foot is the quickest thing in the walk-up. */
  wideScale: 1.15,
  /** Arm swing while walking: the hands swing this far (m) per metre of stagger of the feet. */
  swing: 0.7,
  /** A free hand keeps this far from the axis of a thigh (m): a mitt and a thigh, 0.132, and a margin. */
  armClear: 0.152,
  /** A sumo approach widens in steps: where the left foot stands after its first step and the right after its second (ankle z, and the share of the final turn-out). */
  widen: { l2z: 0.27, l2yaw: 0.3, r3z: 0.3, r3yaw: 0.55 },
  /** Longest hip-to-ankle distance while walking: a clear bend (about 164 degrees) at the knee, because a leg that is nearly straight turns the smallest change of its length into a large swing of the knee. */
  walkReach: 0.86 * Math.sin(72 * DEG),
  pull: 300,
  /** The smoothing (m) of the minimum that takes the pelvis height from the reach of the two legs while walking: a sharper one turns the moment a step starts and the other leg takes the load into a kink of the pelvis and the knees. */
  heightSoft: 0.02,
};

