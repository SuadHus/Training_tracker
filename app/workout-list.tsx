import Link from "next/link";
import type { WorkoutSummary } from "@/src/lib/public-data";
import { displayDay, numberLabel } from "@/src/lib/training-public";

export function WorkoutList({ workouts }: { workouts: WorkoutSummary[] }) {
  if (!workouts.length) return <p className="empty">Completed workouts will appear here.</p>;
  return <ul className="workout-list">
    {workouts.map((item) => <li key={item.id}>
      <Link href={`/training/${item.id}`}>
        <span className="workout-identity">
          <span className="workout-title">{item.title}</span>
          <time dateTime={item.day}>{displayDay(item.day)}</time>
        </span>
        <span className="workout-volume">
          <strong>{numberLabel.format(item.tonnage)} kg</strong>
          <small>{item.work_sets} working {item.work_sets === 1 ? "set" : "sets"}</small>
        </span>
        <span aria-hidden="true" className="arrow">↗</span>
      </Link>
    </li>)}
  </ul>;
}
