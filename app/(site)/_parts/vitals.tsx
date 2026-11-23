import type { ReactNode } from "react";
import { Num } from "@/app/ui/notation";
import type { DailyVitals } from "@/src/lib/public-data";
import { Dec } from "./sets";

function Sleep({ minutes }: { minutes: number }) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return <>
    {hours > 0 && <>{hours} <span className="unit">h</span> </>}
    {(rest > 0 || hours === 0) && <>{rest} <span className="unit">min</span></>}
  </>;
}

export function vitalRows(vitals?: DailyVitals | null): Array<[string, ReactNode]> {
  return [
    vitals?.body_weight_kg != null && ["Bodyweight", <><Dec value={vitals.body_weight_kg} /> <span className="unit">kg</span></>],
    vitals?.sleep_minutes != null && ["Sleep", <Sleep minutes={vitals.sleep_minutes} />],
    vitals?.resting_heart_rate != null && ["Resting heart rate", <><Num value={vitals.resting_heart_rate} /> <span className="unit">bpm</span></>],
    vitals?.sleep_score != null && ["Sleep score", <Num value={vitals.sleep_score} />],
  ].filter((row) => row !== false) as Array<[string, ReactNode]>;
}

export function VitalsTable({
  vitals,
  caption,
  className,
}: {
  vitals?: DailyVitals | null;
  caption?: string;
  className?: string;
}) {
  const rows = vitalRows(vitals);
  if (!rows.length) return null;
  return (
    <table className={className ? `facts ${className}` : "facts"}>
      {caption && <caption>{caption}</caption>}
      <tbody>
        {rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td className="num">{value}</td></tr>)}
      </tbody>
    </table>
  );
}
