import { formatNumber, platesPerSide, STANDARD_BAR_KG } from "@/src/lib/workout-doc";

// A barbell load drawn as the plates on the bar, in the calibrated colours:
// 25 red, 20 blue, 15 yellow, 10 green, 5 white, 2.5 black, 1.25 steel.
// Thickness and height step down with the weight, so the drawing also reads
// without colour. The bar keeps one length per size, so stacked rows compare.

type Size = "inline" | "row" | "tool" | "hero" | "hero-tight";

const plateShape: Record<number, { width: number; height: number; className: string }> = {
  25: { width: 6, height: 30, className: "p-25" },
  20: { width: 5, height: 30, className: "p-20" },
  15: { width: 4.5, height: 26, className: "p-15" },
  10: { width: 4, height: 21, className: "p-10" },
  5: { width: 3, height: 15, className: "p-5" },
  2.5: { width: 2.5, height: 12, className: "p-2-5" },
  1.25: { width: 2, height: 10, className: "p-1-25" },
};

const height = 32;
const middle = height / 2;
const gap = 0.75;
// "hero" spans a desk-wide column; "hero-tight" keeps the plates tall on a phone by shortening the shaft.
const shaftLength: Record<Size, number> = { inline: 22, row: 30, tool: 30, hero: 124, "hero-tight": 40 };
const sleeveLength: Record<Size, number> = { inline: 40, row: 44, tool: 44, hero: 50, "hero-tight": 48 };

/** "25 + 25 + 10", or "empty bar" when nothing is loaded. null when the load cannot be made from plates. */
export function perSide(load: number, barKg: number | null = STANDARD_BAR_KG): string | null {
  const plates = platesPerSide(load, barKg ?? STANDARD_BAR_KG);
  if (!plates) return null;
  return plates.length ? plates.map(formatNumber).join(" + ") : "empty bar";
}

export function BarLoad({ load, barKg, size = "row", className }: {
  load: number;
  barKg?: number | null;
  size?: Size;
  className?: string;
}) {
  const bar = barKg ?? STANDARD_BAR_KG;
  const plates = platesPerSide(load, bar);
  if (!plates) return null;

  const stack = plates.reduce((total, plate) => total + plateShape[plate].width + gap, 0);
  const sleeve = Math.max(sleeveLength[size], stack + 9);
  const shaft = shaftLength[size];
  const width = shaft + 2 * sleeve;
  const left = sleeve;
  const right = sleeve + shaft;

  const shapes: Array<{ key: string; x: number; width: number; height: number; className: string }> = [];
  let offset = 2.5 + gap;
  plates.forEach((plate, index) => {
    const shape = plateShape[plate];
    shapes.push({ key: `r${index}`, x: right + offset, ...shape });
    shapes.push({ key: `l${index}`, x: left - offset - shape.width, ...shape });
    offset += shape.width + gap;
  });

  const label = `${formatNumber(load)} kg: bar ${formatNumber(bar)} kg, ${plates.length ? `per side ${plates.map(formatNumber).join(" + ")}` : "nothing loaded"}`;

  return (
    <svg
      className={["bar", `bar--${size === "hero-tight" ? "hero" : size}`, className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      <rect className="bar-steel" x={0} y={middle - 1.75} width={left} height={3.5} />
      <rect className="bar-steel" x={right} y={middle - 1.75} width={sleeve} height={3.5} />
      <rect className="bar-steel" x={left} y={middle - 1} width={shaft} height={2} />
      <rect className="bar-steel" x={left - 2.5} y={middle - 4.5} width={2.5} height={9} />
      <rect className="bar-steel" x={right} y={middle - 4.5} width={2.5} height={9} />
      {shapes.map((shape) => (
        <rect key={shape.key} className={shape.className} x={shape.x} y={middle - shape.height / 2} width={shape.width} height={shape.height} />
      ))}
      {plates.length > 0 && <>
        <rect className="bar-steel" x={right + offset} y={middle - 3.5} width={3} height={7} />
        <rect className="bar-steel" x={left - offset - 3} y={middle - 3.5} width={3} height={7} />
      </>}
    </svg>
  );
}
