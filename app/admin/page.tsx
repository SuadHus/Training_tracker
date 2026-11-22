import Link from "next/link";
import { query } from "../../src/lib/db";
import { requireOwner } from "../../src/lib/owner";
import { trainingDay } from "../../src/lib/training-admin";
import { GoogleSignOut } from "../login/sign-in";
import { addExercise, addField, createWorkout } from "./actions";
import styles from "./admin.module.css";

type Workout = { id: string; title: string; day: string | null; status: "template" | "planned" | "completed" };
type Exercise = { id: string; name: string; type: string; primary_muscle: string };
type Column = { id: string; label: string; kind: string; unit: string; exercise: string | null };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const [workouts, exercises, columns, { error }] = await Promise.all([
    query<Workout>(`SELECT id, title, local_day::text AS day, status FROM workouts
      ORDER BY local_day DESC NULLS LAST, title`),
    query<Exercise>("SELECT id, name, type, primary_muscle FROM exercises ORDER BY name"),
    query<Column>(`SELECT field_definitions.id, label, kind, unit, name AS exercise
      FROM field_definitions LEFT JOIN exercises ON exercises.id = exercise_id ORDER BY label`),
    searchParams,
  ]);
  const today = trainingDay();
  const planned = workouts.rows.filter((workout) => workout.status === "planned").reverse();
  const todayWorkouts = planned.filter((workout) => workout.day === today);
  const otherPlanned = planned.filter((workout) => workout.day !== today);
  const templates = workouts.rows.filter((workout) => workout.status === "template");
  const completed = workouts.rows.filter((workout) => workout.status === "completed");

  function workoutList(items: Workout[]) {
    return (
      <ul className={styles.entries}>
        {items.map((workout) => (
          <li key={workout.id}>
            <Link href={`/admin/workouts/${workout.id}`}>
              <strong>{workout.title}</strong>
              {workout.day && <time dateTime={workout.day}>{workout.day === today ? "Today" : workout.day}</time>}
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <p className={styles.kicker}>Owner</p>
      <h1>Training admin</h1>
      <nav aria-label="Owner tools" className={styles.nav}>
        <a href="#schedule">Plan a workout</a>
        <a href="#exercises">Exercises</a>
        <a href="#fields">Custom fields</a>
        <Link href="/admin/connections">Connections</Link>
        <Link href="/studio">Journal &amp; vitals</Link>
        <GoogleSignOut />
      </nav>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.columns}>
        <div>
          <section className={styles.section} id="schedule">
            <h2>Schedule</h2>
            {todayWorkouts.length > 0 && <><h3>Today</h3>{workoutList(todayWorkouts)}</>}
            {otherPlanned.length > 0 && <><h3>Other scheduled workouts</h3>{workoutList(otherPlanned)}</>}
            {!planned.length && <p>No workouts are scheduled.</p>}
            <details className={styles.toggle} open={!planned.length || undefined}>
              <summary>Schedule a workout</summary>
              <form action={createWorkout} className={styles.form}>
                <input type="hidden" name="status" value="planned" />
                <label>Workout date<input name="local_day" type="date" defaultValue={today} required /></label>
                {templates.length > 0 && (
                  <label>Start from a template
                    <select name="template_id">
                      <option value="">Blank workout</option>
                      {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                    </select>
                  </label>
                )}
                <label>Workout name
                  <input name="title" maxLength={120} required={!templates.length} placeholder={templates.length ? "Optional with a template" : "e.g. Lower body A"} />
                </label>
                <div className={styles.actions}><button>Schedule workout</button></div>
              </form>
            </details>
          </section>
          <section className={styles.section}>
            <h2>Templates</h2>
            {workoutList(templates)}
            <details className={styles.toggle}>
              <summary>Create a reusable template</summary>
              <form action={createWorkout} className={styles.form}>
                <input type="hidden" name="status" value="template" />
                <label>Template name<input name="title" maxLength={120} required placeholder="e.g. Full body A" /></label>
                <div className={styles.actions}><button>Create template</button></div>
              </form>
            </details>
          </section>
          {completed.length > 0 && (
            <section className={styles.section}>
              <h2>Completed workouts</h2>
              {workoutList(completed.slice(0, 8))}
              {completed.length > 8 && <details className={styles.toggle}><summary>Earlier workouts</summary>{workoutList(completed.slice(8))}</details>}
            </section>
          )}
        </div>
        <div>
          <section className={styles.section} id="exercises">
            <h2>Exercise library</h2>
            {exercises.rows.length > 0 && (
              <ul className={styles.looseList}>
                {exercises.rows.map(({ id, name, type, primary_muscle }) => (
                  <li key={id}><strong>{name}</strong> · {type} · {primary_muscle}</li>
                ))}
              </ul>
            )}
            <details className={styles.toggle} open={!exercises.rows.length || undefined}>
              <summary>Add an exercise</summary>
              <form action={addExercise} className={styles.form}>
                <label>Exercise name<input name="name" maxLength={100} required placeholder="e.g. Back squat" /></label>
                <label>Type
                  <input name="type" list="exercise-types" maxLength={40} required placeholder="e.g. Strength" />
                </label>
                <datalist id="exercise-types">
                  <option>Strength</option><option>Bodyweight</option><option>Cardio</option><option>Mobility</option>
                </datalist>
                <label>Primary muscle<input name="primary_muscle" maxLength={50} required placeholder="e.g. Quadriceps" /></label>
                <label>Secondary muscles (optional)
                  <input name="secondary_muscles" maxLength={350} placeholder="e.g. Glutes, Adductors" />
                </label>
                <div className={styles.actions}><button>Add exercise</button></div>
              </form>
            </details>
          </section>
          <section className={styles.section} id="fields">
            <h2>Custom set fields</h2>
            {columns.rows.length > 0 && (
              <ul className={styles.looseList}>
                {columns.rows.map(({ id, label, kind, unit, exercise }) => (
                  <li key={id}><strong>{label}{unit && ` (${unit})`}</strong> · {kind} · {exercise ?? "All exercises"}</li>
                ))}
              </ul>
            )}
            <details className={styles.toggle}>
              <summary>Add a field</summary>
              <form action={addField} className={styles.form}>
                <label>Field label<input name="label" maxLength={60} required placeholder="e.g. Bar speed" /></label>
                <div className={styles.fields}>
                  <label>Value type<select name="kind"><option value="decimal">Decimal</option><option value="integer">Whole number</option><option value="text">Text</option></select></label>
                  <label>Unit (optional)<input name="unit" maxLength={20} placeholder="e.g. m/s" /></label>
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
