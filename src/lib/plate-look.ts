// The site's plates, in one table: how the loaded bar draws each one (width and height in the bar drawing's units, and the
// class that carries its colour) and how the lifter's stage draws it (its real diameter in metres). The colour itself is in
// the stylesheet, as tokens: 25 red, 20 blue, 15 yellow, 10 green, 5 white, 2.5 black, 1.25 steel.

export type PlateShape = { width: number; height: number; className: string; diameter: number };

export const PLATE_SHAPE: Readonly<Record<number, PlateShape>> = {
  25: { width: 6, height: 30, className: "p-25", diameter: 0.45 },
  20: { width: 5, height: 30, className: "p-20", diameter: 0.45 },
  15: { width: 4.5, height: 26, className: "p-15", diameter: 0.4 },
  10: { width: 4, height: 21, className: "p-10", diameter: 0.325 },
  5: { width: 3, height: 15, className: "p-5", diameter: 0.228 },
  2.5: { width: 2.5, height: 12, className: "p-2-5", diameter: 0.19 },
  1.25: { width: 2, height: 10, className: "p-1-25", diameter: 0.16 },
};

export type PlateLook = { cls: string; diameter: number; thickness: number };

/** Metres of thickness per unit of the site's plate width: about twice the real thickness, so that the colours read and a stack can be counted. */
const THICKNESS_PER_UNIT = 0.0085;

/** The 5, 2.5 and 1.25 kg plates are a tenth thicker still, so that at phone size they read as plates and not as hairlines. */
const SMALL_PLATE_BOOST = 1.1;

/** How a plate of this weight is drawn on the stage (the 1.25 kg look for any weight the site has no plate for). */
export function plateLook(kg: number): PlateLook {
  const weight = kg in PLATE_SHAPE ? kg : 1.25;
  const shape = PLATE_SHAPE[weight];
  const boost = weight <= 5 ? SMALL_PLATE_BOOST : 1;
  return { cls: shape.className, diameter: shape.diameter, thickness: shape.width * THICKNESS_PER_UNIT * boost };
}
