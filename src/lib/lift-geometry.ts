// Flat shapes as SVG path data, in screen units. Pure functions, no DOM.
//
// Everything the mannequin is made of is a sphere, a capsule or a disc, and a parallel projection turns each of
// those into a circle, a round-ended tapered shape or an ellipse pair: that is all this file knows how to write.

export type P2 = readonly [x: number, y: number];

/** One decimal, no "-0": the only way a number enters an attribute. */
export function fmt(value: number): string {
  const tenths = Math.round(value * 10);
  if (tenths === 0) return "0";
  const abs = tenths < 0 ? -tenths : tenths;
  const whole = (abs / 10) | 0, frac = abs - whole * 10;
  return (tenths < 0 ? "-" : "") + whole + (frac ? "." + frac : "");
}
const pt = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;

/** A circle as a closed sub-path, so that circles can share one path with other shapes. */
export function circleSub(c: P2, r: number): string {
  const radius = fmt(Math.max(r, 0.1));
  return `M${pt(c[0] - r, c[1])}A${radius} ${radius} 0 1 0 ${pt(c[0] + r, c[1])}A${radius} ${radius} 0 1 0 ${pt(c[0] - r, c[1])}Z`;
}

/** The outline of two circles and the two tangent lines between them: a limb with a round end and a taper. */
export function capsuleSub(c1: P2, r1: number, c2: P2, r2: number): string {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  // One circle swallows the other (or they coincide): the outline is the bigger circle.
  if (d <= Math.abs(r1 - r2) + 1e-6) return r1 >= r2 ? circleSub(c1, r1) : circleSub(c2, r2);
  const ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
  const cos = (r1 - r2) / d, sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const mx = cos * ux + sin * nx, my = cos * uy + sin * ny; // normal of one tangent line
  const kx = cos * ux - sin * nx, ky = cos * uy - sin * ny; // normal of the other
  const farLarge = cos < 0 ? 1 : 0; // arc at the second circle spans 2*acos(cos): large when cos < 0
  const nearLarge = cos > 0 ? 1 : 0;
  return `M${pt(c1[0] + r1 * mx, c1[1] + r1 * my)}L${pt(c2[0] + r2 * mx, c2[1] + r2 * my)}` +
    `A${fmt(r2)} ${fmt(r2)} 0 ${farLarge} 0 ${pt(c2[0] + r2 * kx, c2[1] + r2 * ky)}` +
    `L${pt(c1[0] + r1 * kx, c1[1] + r1 * ky)}` +
    `A${fmt(r1)} ${fmt(r1)} 0 ${nearLarge} 0 ${pt(c1[0] + r1 * mx, c1[1] + r1 * my)}Z`;
}

/**
 * The convex hull of circles (a torso is the hull of its hips, waist, ribs and shoulders): for each of 32 directions
 * the point of the circle that reaches furthest that way. No sorting, no search.
 */
const HULL_STEPS = 32;
const HULL_COS: number[] = [], HULL_SIN: number[] = [];
// Counter-clockwise on the screen, like a capsule's outline: hulls and capsules share one path and one fill without cancelling.
for (let i = 0; i < HULL_STEPS; i++) { HULL_COS.push(Math.cos((i / HULL_STEPS) * Math.PI * 2)); HULL_SIN.push(-Math.sin((i / HULL_STEPS) * Math.PI * 2)); }

/** The outline of the convex hull of circles, as a closed sub-path. */
export function hullSub(circles: ReadonlyArray<readonly [P2, number]>): string {
  let d = "";
  for (let i = 0; i < HULL_STEPS; i++) {
    const dx = HULL_COS[i], dy = HULL_SIN[i];
    let best = -Infinity, bx = 0, by = 0;
    for (let k = 0; k < circles.length; k++) {
      const c = circles[k][0], r = circles[k][1];
      const reach = c[0] * dx + c[1] * dy + r;
      if (reach > best) { best = reach; bx = c[0] + r * dx; by = c[1] + r * dy; }
    }
    d += (i === 0 ? "M" : "L") + pt(bx, by);
  }
  return d + "Z";
}

/** An ellipse as a closed sub-path: centre, semi-axes, rotation of the first axis in radians. */
export function ellipseSub(c: P2, a: number, b: number, rotation: number): string {
  const ca = Math.cos(rotation), sa = Math.sin(rotation);
  const x1 = c[0] - a * ca, y1 = c[1] - a * sa, x2 = c[0] + a * ca, y2 = c[1] + a * sa;
  const deg = fmt((rotation * 180) / Math.PI);
  const rx = fmt(Math.max(a, 0.1)), ry = fmt(Math.max(b, 0.1));
  return `M${pt(x1, y1)}A${rx} ${ry} ${deg} 1 0 ${pt(x2, y2)}A${rx} ${ry} ${deg} 1 0 ${pt(x1, y1)}Z`;
}

/**
 * A short cylinder whose axis is the world z axis (a plate, a collar, a sleeve, a shaft) as one outline:
 * the two end ellipses and the band between them. `axis` is the projected axis (a unit-length world z vector
 * in screen units), `half` the projected half length of the cylinder as a screen vector, `radius` in screen units,
 * `facing` the cosine between the axis and the line of sight (the ellipse's minor-to-major ratio).
 */
export function discHullSub(centre: P2, half: P2, radius: number, facing: number, axisDir: P2): string {
  const a = radius;
  const b = radius * Math.min(1, Math.abs(facing));
  const len = Math.hypot(axisDir[0], axisDir[1]);
  // Major axis of the end ellipses: perpendicular to the projected axis. Face-on, they are circles and any will do.
  const ux = len > 1e-6 ? -axisDir[1] / len : 1, uy = len > 1e-6 ? axisDir[0] / len : 0;
  const vx = -uy, vy = ux;
  const dx = 2 * half[0], dy = 2 * half[1];
  const du = dx * ux + dy * uy, dv = dx * vx + dy * vy;
  const theta = Math.atan2(-b * du, a * dv);
  // Points on an end ellipse at parameter t, for the end centred at (cx, cy).
  const at = (cx: number, cy: number, t: number): P2 => [cx + a * Math.cos(t) * ux + b * Math.sin(t) * vx, cy + a * Math.cos(t) * uy + b * Math.sin(t) * vy];
  // The extreme point of an ellipse along the displacement is the tangent direction at theta.
  const tx = -a * Math.sin(theta) * ux + b * Math.cos(theta) * vx, ty = -a * Math.sin(theta) * uy + b * Math.cos(theta) * vy;
  const sweep = tx * dx + ty * dy > 0 ? 0 : 1;
  const c0: P2 = [centre[0] - half[0], centre[1] - half[1]], c1: P2 = [centre[0] + half[0], centre[1] + half[1]];
  const p0a = at(c0[0], c0[1], theta), p0b = at(c0[0], c0[1], theta + Math.PI);
  const p1a = at(c1[0], c1[1], theta), p1b = at(c1[0], c1[1], theta + Math.PI);
  const rx = fmt(Math.max(a, 0.1)), ry = fmt(Math.max(b, 0.1));
  const rot = fmt((Math.atan2(uy, ux) * 180) / Math.PI);
  return `M${pt(p0a[0], p0a[1])}A${rx} ${ry} ${rot} 0 ${sweep} ${pt(p0b[0], p0b[1])}L${pt(p1b[0], p1b[1])}A${rx} ${ry} ${rot} 0 ${sweep} ${pt(p1a[0], p1a[1])}Z`;
}
