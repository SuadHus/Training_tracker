import { publicProgress, publicWorkouts } from "@/src/lib/public-data";
import { numberLabel } from "@/src/lib/training-public";
import { WorkoutList } from "../workout-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training" };

export default async function Training() {
  const [workouts, { lifts }] = await Promise.all([publicWorkouts(), publicProgress()]);
  return <>
    <section className="intro">
      <p className="eyebrow">Workout history</p>
      <h1>Training</h1>
    </section>
    <div className="home-grid">
      <section aria-label="Completed workouts"><WorkoutList workouts={workouts} /></section>
      {Boolean(lifts.length) && <section>
        <div className="section-heading"><h2>Best estimated lifts</h2></div>
        <ul className="progress-lifts">
          {lifts.map((lift) => <li key={lift.id}>
            <span>{lift.name}<small>{numberLabel.format(lift.weight)} kg × {lift.reps}</small></span>
            <strong>{numberLabel.format(lift.estimate)} kg</strong>
          </li>)}
        </ul>
        <p className="muted">Estimated 1RM from working sets of up to 10 reps.</p>
      </section>}
    </div>
  </>;
}
