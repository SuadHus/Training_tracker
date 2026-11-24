// The pose of the lifter at one instant: what a motion model hands to a drawing.
// Nothing here knows how the pose was computed or how it will be drawn.
//
// World, in metres. x is the way the lifter faces (on the bench: from the head toward
// the feet). y is up from the floor. z points to the lifter's right hand. The bar is
// level and runs along z.

import type { LiftFamily } from "./lifts";

export type Vec3 = readonly [x: number, y: number, z: number];
export type Sided<T> = { R: T; L: T };

export type LiftPose = {
  /** Midpoint of the two hip joints. */
  pelvis: Vec3;
  /** Where the lower back meets the rib cage. On a model with a rigid torso: 44% of the way from pelvis to chest. */
  waist: Vec3;
  /** The top of the spine, between the shoulders: the midpoint of the two shoulder joints, except on the bench, where the joints are set back from it onto the pad. */
  chest: Vec3;
  /** Centre of the head, a ball of radius 0.105. */
  head: Vec3;
  hip: Sided<Vec3>;
  knee: Sided<Vec3>;
  ankle: Sided<Vec3>;
  /** Where the sole ends at the back of the foot, and at the tip of the toes: points on the sole, so they touch the floor while the foot is planted. */
  heel: Sided<Vec3>;
  toe: Sided<Vec3>;
  shoulder: Sided<Vec3>;
  elbow: Sided<Vec3>;
  wrist: Sided<Vec3>;
  /** Centre of the closed hand: on the bar while gripping. */
  hand: Sided<Vec3>;
  /** Centre of the bar. */
  bar: Vec3;
  /** Both hands are on the bar. */
  gripping: boolean;
};

/** What stands on the floor around the lifter, fixed for the whole set. */
export type LiftScene = {
  family: LiftFamily;
  /** Squat and bench: the uprights that hold the bar. x of the posts, y of the bar centre when it rests in the hooks, half the distance between the posts. */
  rack: { x: number; barX: number; barY: number; halfWidth: number; height: number } | null;
  /** Bench: the pad the lifter lies on. */
  bench: { headX: number; footX: number; top: number; halfWidth: number } | null;
  /**
   * Deadlift only: height of the bar's centre while it rests on the
   * floor. The drawing puts a block under each sleeve when the plates are too small to reach the floor. null otherwise.
   */
  barRestY: number | null;
};

/** Segment sizes shared by the motion models and the drawing, in metres. */
export const BODY = {
  ankleHeight: 0.08, shank: 0.43, thigh: 0.43, hipHalf: 0.095, torso: 0.5, shoulderHalf: 0.19,
  upperArm: 0.31, forearm: 0.27, hand: 0.08, neck: 0.255, headRadius: 0.105, heel: 0.06, toe: 0.2,
} as const;

/** The bar, in metres. */
export const BAR = { length: 2.2, shaft: 1.31, sleeve: 0.415, shaftRadius: 0.0145, sleeveRadius: 0.025, collar: 0.03 } as const;
