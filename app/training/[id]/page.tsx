import Link from "next/link";
import { notFound } from "next/navigation";
import { publicWorkout } from "@/src/lib/public-data";
import { displayDay, numberLabel as fmt, summarizeWorkout, validId, valueForField } from "@/src/lib/training-public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workout" };

function duration(minutes: number | null) {
  if (minutes === null) return null;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default async function Workout({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) notFound();
  const workout = await publicWorkout(id);
  if (!workout) notFound();
  const { sets, vitals, fields } = workout;
  const summary = summarizeWorkout(sets.map((set) => ({
    reps: set.reps, loadKg: set.load_kg, rpe: set.rpe, warmup: set.warmup, primaryMuscle: set.primary_muscle,
  })));
  const groups = Map.groupBy(sets, (set) => set.exercise_id);
  const dayVitals = [
    ["Resting heart rate", vitals.resting_heart_rate === null ? null : `${fmt.format(vitals.resting_heart_rate)} bpm`],
    ["Sleep duration", duration(vitals.sleep_minutes)],
    ["Fitbit Sleep Score", vitals.sleep_score === null ? null : `${vitals.sleep_score}/100`],
    ["Morning bodyweight", vitals.body_weight_kg === null ? null : `${fmt.format(vitals.body_weight_kg)} kg`],
  ];
  const muscles = Object.entries(summary.muscles).sort((a, b) => b[1] - a[1]);
  return <>
    <section className="intro">
      <Link href="/training" className="back-link">← All workouts</Link>
      <p className="eyebrow"><time dateTime={workout.day}>{displayDay(workout.day)}</time></p>
      <h1>{workout.title}</h1>
      {workout.notes && <p className="lede prose">{workout.notes}</p>}
    </section>
    <div className="home-grid">
      <section aria-label="Workout sets">
        <dl className="workout-stats">
          <div><dt>Working sets</dt><dd>{summary.workSets}</dd></div>
          <div><dt>Work-set volume</dt><dd>{fmt.format(summary.tonnage)} kg</dd></div>
          <div><dt>Average RPE</dt><dd>{summary.averageRpe === null ? "—" : fmt.format(summary.averageRpe)}</dd></div>
        </dl>
        {[...groups].map(([exerciseId, group]) => <article className="exercise" key={exerciseId}>
          <h2>{group[0].exercise}</h2>
          <p className="muted">{[group[0].exercise_type, group[0].primary_muscle, ...group[0].secondary_muscles].join(" · ")}</p>
          <ol className="sets">
            {group.map((set) => <li key={set.id}>
              <div className="set-line">
                {set.warmup && <strong className="warmup">Warm-up</strong>}
                {set.reps !== null && <span>{set.reps} reps</span>}
                {set.load_kg !== null && <span>{fmt.format(set.load_kg)} kg</span>}
                {set.rpe !== null && <span>RPE {fmt.format(set.rpe)}</span>}
                {set.duration_seconds !== null && <span>{fmt.format(set.duration_seconds)} s</span>}
                {set.distance_meters !== null && <span>{fmt.format(set.distance_meters)} m</span>}
              </div>
              <ul className="custom-values">
                {fields.filter((field) => field.exercise_id === null || field.exercise_id === exerciseId).map((field) => {
                  const value = valueForField(set.custom_values, field.id, field.unit);
                  return value === null ? null : <li key={field.id}>{field.label} <strong>{value}</strong></li>;
                })}
              </ul>
            </li>)}
          </ol>
        </article>)}
      </section>
      <aside className="detail-rail" aria-label="Workout and recovery breakdown">
        <section className="daily-vitals public-panel" aria-labelledby="day-vitals">
          <div className="section-heading"><h2 id="day-vitals">Day vitals</h2></div>
          <dl>
            {dayVitals.map(([label, value]) => <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></>}</dd>
            </div>)}
          </dl>
          <p className="muted">Sleep is shown for the day it ended.</p>
        </section>
        {muscles.length > 0 && <section className="public-panel" aria-labelledby="muscle-breakdown">
          <div className="section-heading"><h2 id="muscle-breakdown">Working sets by muscle</h2></div>
          <ul className="progress-lifts">{muscles.map(([name, count]) =>
            <li key={name}><span>{name}</span><strong>{count}</strong></li>)}</ul>
        </section>}
      </aside>
    </div>
  </>;
}
