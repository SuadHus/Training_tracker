// The small maths the motion model and its tables share: vectors, easings, smooth minimum and maximum.

/** A point or a direction in metres: x, y (up), z. */
export type V = [number, number, number];
/** One degree in radians. */
export const DEG = Math.PI / 180;
/** `x` held between `a` and `b`. */
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
/** The value u of the way from a to b. */
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** 0 -> 1 with zero slope at both ends (half cosine). */
export const sine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u));
/** 0 -> 1 with zero slope and zero curvature at both ends. */
export const smooth = (u: number) => { u = clamp(u); return u * u * u * (u * (6 * u - 15) + 10); };
/** A straight 0 -> 1 ramp. */
export const lin = (u: number) => clamp(u);
/** a - b. */
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** a + b. */
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** a scaled by k. */
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
/** The dot product. */
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The length of a vector. */
export const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
/** The vector of length 1 that points the way a does. */
export const unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** The point u of the way from a to b. */
export const mix = (a: V, b: V, u: number): V => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** A smooth maximum of a and b: exactly max(a, b) when they differ by more than k (the mirror of `smin`). */
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
/** A smooth minimum: exactly min(a, b) when they differ by more than k. */
export const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - (h * h * k) / 4; };

