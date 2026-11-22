import { randomUUID } from "node:crypto";
import Link from "next/link";
import { query } from "@/src/lib/db";
import { requireOwner } from "@/src/lib/owner";
import { trainingDay } from "@/src/lib/training-admin";
import { displayDay } from "@/src/lib/training-public";
import { GoogleSignOut } from "../login/sign-in";
import { addExercise, addField, createWorkout } from "./actions";
import { WorkoutPlanner } from "./workout-planner";
import { WorkoutSubmit } from "./workout-submit";
import styles from "./admin.module.css";

export const metadata = { title: "Owner workspace", robots: { index: false, follow: false } };

type Workout = {
  id: string;
  title: string;
  day: string | null;
  status: "template" | "planned" | "completed";
  set_count: number;
  exercise_count: number;
  logged_count: number;
};
type Exercise = { id: string; name: string; type: string; primary_muscle: string };
type Column = { id: string; label: string; kind: string; unit: string; exercise: string | null };

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function WorkoutQueue({ items, today }: { items: Workout[]; today: string }) {
  return (
    <ul className={styles.queue}>
      {items.map((workout) => (
        <li key={workout.id}>
          <Link href={`/admin/workouts/${workout.id}`}>
            <div>
              <strong>{workout.title}</strong>
              <small>{workout.status === "completed" ? countLabel(workout.logged_count, "logged set")
                : workout.logged_count > 0 ? `${workout.logged_count} of ${workout.set_count} sets logged`
                : countLabel(workout.set_count, "target set")}</small>
            </div>
            {workout.day && <time dateTime={workout.day}>{workout.day === today ? "Today" : displayDay(workout.day)}</time>}
            <span aria-hidden="true">↗</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const [workouts, exercises, columns, { error }] = await Promise.all([
    query<Workout>(`SELECT w.id, w.title, w.local_day::text AS day, w.status,
      count(s.id)::int AS set_count, count(DISTINCT s.exercise_id)::int AS exercise_count,
      (count(s.id) FILTER (WHERE s.logged_at IS NOT NULL OR s.reps IS NOT NULL OR s.duration_seconds IS NOT NULL
        OR s.distance_meters IS NOT NULL OR s.custom_values <> '{}'::jsonb))::int AS logged_count
      FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id
      GROUP BY w.id ORDER BY w.local_day DESC NULLS LAST, w.title, w.id`),
    query<Exercise>("SELECT id, name, type, primary_muscle FROM exercises ORDER BY name"),
    query<Column>(`SELECT field_definitions.id, label, kind, unit, name AS exercise
      FROM field_definitions LEFT JOIN exercises ON exercises.id = exercise_id ORDER BY label`),
    searchParams,
  ]);
  const today = trainingDay();
  const planned = workouts.rows.filter((workout) => workout.status === "planned");
  const todayWorkouts = planned.filter((workout) => workout.day === today);
  const upcoming = planned.filter((workout) => workout.day && workout.day > today)
    .sort((first, second) => first.day!.localeCompare(second.day!));
  const unfinished = planned.filter((workout) => workout.day && workout.day < today);
  const templates = workouts.rows.filter((workout) => workout.status === "template");
  const completed = workouts.rows.filter((workout) => workout.status === "completed");

  return (
    <>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.kicker}>Owner workspace</p>
          <h1>Training desk</h1>
        </div>
        <time className={styles.workspaceDate} dateTime={today}>{displayDay(today)}</time>
      </header>
      <nav aria-label="Owner tools" className={styles.workspaceNav}>
        <a href="#schedule">Workouts</a>
        <a href="#templates">Templates</a>
        <a href="#exercises">Exercise library</a>
        <a href="#fields">Custom fields</a>
        <Link href="/admin/connections">Health connections</Link>
        <Link href="/studio">Publishing</Link>
        <GoogleSignOut />
      </nav>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.workspaceGrid}>
        <div className={styles.workspaceStack}>
          <section className={`${styles.panel} ${styles.todayPanel}`} id="schedule">
            <div className={styles.panelHeading}>
              <h2>Today’s workouts</h2>
              <a className={styles.panelLink} href="#plan-workout">New workout <span aria-hidden="true">→</span></a>
            </div>
            {todayWorkouts.length
              ? <WorkoutQueue items={todayWorkouts} today={today} />
              : <p className={styles.emptyState}>You don’t have a workout scheduled for today.</p>}
          </section>
          <section className={styles.panel} id="templates" tabIndex={-1}>
            <div className={styles.panelHeading}>
              <h2>Templates</h2>
              <a className={styles.panelLink} href="#new-template">New template <span aria-hidden="true">↓</span></a>
            </div>
            {templates.length ? (
              <ul className={styles.templateList}>
                {templates.map((template) => (
                  <li key={template.id}>
                    <Link href={`/admin/workouts/${template.id}`}>
                      <strong>{template.title}</strong>
                      <small>{countLabel(template.exercise_count, "exercise")} · {countLabel(template.set_count, "target set")}</small>
                    </Link>
                    <form action={createWorkout}>
                      <input type="hidden" name="status" value="planned" />
                      <input type="hidden" name="timing" value="today" />
                      <input type="hidden" name="submission_id" value={randomUUID()} />
                      <input type="hidden" name="template_id" value={template.id} />
                      <WorkoutSubmit className={styles.secondaryButton} pendingLabel="Opening…">Use today</WorkoutSubmit>
                    </form>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.emptyState}>Create a template to reuse your exercises and set targets.</p>}
            <form id="new-template" tabIndex={-1} action={createWorkout} className={`${styles.form} ${styles.inlineForm}`}>
              <input type="hidden" name="status" value="template" />
              <input type="hidden" name="submission_id" value={randomUUID()} />
              <label>New template name<input name="title" maxLength={120} required placeholder="e.g. Full body A" /></label>
              <WorkoutSubmit>Create template</WorkoutSubmit>
            </form>
          </section>
          {(upcoming.length > 0 || unfinished.length > 0 || completed.length > 0) && (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><h2>Workout history &amp; schedule</h2></div>
              {upcoming.length > 0 && <><h3 className={styles.groupHeading}>Upcoming</h3><WorkoutQueue items={upcoming} today={today} /></>}
              {unfinished.length > 0 && <><h3 className={styles.groupHeading}>Earlier unfinished</h3><WorkoutQueue items={unfinished} today={today} /></>}
              {completed.length > 0 && <>
                <h3 className={styles.groupHeading}>Completed</h3>
                <WorkoutQueue items={completed.slice(0, 6)} today={today} />
                {completed.length > 6 && <details className={styles.toggle}><summary>Earlier completed workouts</summary><WorkoutQueue items={completed.slice(6)} today={today} /></details>}
              </>}
            </section>
          )}
        </div>
        <div className={styles.workspaceStack}>
          <section className={styles.panel} id="plan-workout" tabIndex={-1}>
            <div className={styles.panelHeading}><h2>New workout</h2></div>
            <WorkoutPlanner today={today} templates={templates} submissionId={randomUUID()} />
          </section>
          <section className={styles.panel} id="exercises">
            <div className={styles.panelHeading}><h2>Exercise library</h2></div>
            {exercises.rows.length > 0 && (
              <ul className={styles.catalog}>
                {exercises.rows.map(({ id, name, type, primary_muscle }) => (
                  <li key={id}><strong>{name}</strong><small>{type} · {primary_muscle}</small></li>
                ))}
              </ul>
            )}
            <details className={styles.toggle} open={!exercises.rows.length || undefined}>
              <summary>Add an exercise</summary>
              <form action={addExercise} className={styles.form}>
                <label>Exercise name<input name="name" maxLength={100} required placeholder="e.g. Back squat" /></label>
                <label>Type<input name="type" list="exercise-types" maxLength={40} required placeholder="e.g. Strength" /></label>
                <datalist id="exercise-types"><option>Strength</option><option>Bodyweight</option><option>Cardio</option><option>Mobility</option></datalist>
                <label>Primary muscle<input name="primary_muscle" maxLength={50} required placeholder="e.g. Quadriceps" /></label>
                <label>Secondary muscles <span className={styles.optional}>Optional</span>
                  <input name="secondary_muscles" maxLength={350} placeholder="e.g. Glutes, Adductors" />
                </label>
                <div className={styles.actions}><button>Add exercise</button></div>
              </form>
            </details>
          </section>
          <section className={styles.panel} id="fields">
            <div className={styles.panelHeading}><h2>Custom set fields</h2></div>
            {columns.rows.length > 0 && (
              <ul className={styles.catalog}>
                {columns.rows.map(({ id, label, kind, unit, exercise }) => (
                  <li key={id}><strong>{label}{unit && ` (${unit})`}</strong><small>{kind} · {exercise ?? "All exercises"}</small></li>
                ))}
              </ul>
            )}
            <details className={styles.toggle}>
              <summary>Add a field</summary>
              <form action={addField} className={styles.form}>
                <label>Field label<input name="label" maxLength={60} required placeholder="e.g. Bar speed" /></label>
                <div className={styles.fields}>
                  <label>Value type<select name="kind"><option value="decimal">Decimal</option><option value="integer">Whole number</option><option value="text">Text</option></select></label>
                  <label>Unit <span className={styles.optional}>Optional</span><input name="unit" maxLength={20} placeholder="e.g. m/s" /></label>
                </div>
                <label>Available for
                  <select name="exercise_id">
                    <option value="">All exercises</option>
                    {exercises.rows.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
                  </select>
                </label>
                <div className={styles.actions}><button>Add field</button></div>
              </form>
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
