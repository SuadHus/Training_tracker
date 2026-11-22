import Link from "next/link";
import type { WorkoutSummary } from "@/src/lib/public-data";
import { displayDay, numberLabel } from "@/src/lib/training-public";

export function WorkoutList({ workouts }: { workouts: WorkoutSummary[] }) {
  if (!workouts.length) return <p className="empty">Completed workouts will appear here.</p>;
  return <ul className="workout-list">
    {workouts.map((item) => <li key={item.id}>
      <Link href={`/training/${item.id}`}>
        <time className="muted" dateTime={item.day}>{displayDay(item.day)}</time>
        <span className="workout-title">{item.title}</span>
        <span className="workout-volume">{item.work_sets} sets · {numberLabel.format(item.tonnage)} kg</span>
        <span aria-hidden="true" className="arrow">↗</span>
      </Link>
    </li>)}
  </ul>;
}
