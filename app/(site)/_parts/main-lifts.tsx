import { LiftStage } from "@/app/ui/lift-stage";
import { stageLifts } from "@/src/lib/week-bars";
import type { WeekSummary } from "@/src/lib/public-data";
import { HeaviestBar } from "./week";

// In a file of its own: only the home page draws the lifter, and a page that takes other parts of a week from `week.tsx`
// must not download the stage with them.

/**
 * The top of a week on the home page: the lifter doing each main lift of the week with the real load and reps, or, when the week has
 * none of the six, the heaviest bar as plates.
 */
export function MainLifts({ week }: { week: WeekSummary }) {
  const lifts = stageLifts(week);
  if (lifts.length === 0) return <HeaviestBar week={week} />;
  return (
    <div className="row row--stack">
      <div className="row-margin">{lifts.length > 1 ? "Main lifts" : "Main lift"}</div>
      <LiftStage lifts={lifts} />
    </div>
  );
}
