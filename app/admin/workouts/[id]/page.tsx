import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "../../../../src/lib/db";
import { requireOwner } from "../../../../src/lib/owner";
import { idInput, type CustomValues } from "../../../../src/lib/training-admin";
import { completeWorkout, removeSet, saveSet, updateWorkout } from "../../actions";
import { NewActualSet, SetDraftForm, SetFields, type AdminField } from "../../set-form";
import styles from "../../admin.module.css";

type Workout = { id: string; title: string; day: string | null; status: "planned" | "template" | "completed"; notes: string };
type Exercise = { id: string; name: string; type: string; primary_muscle: string };
type SetRow = {
  id: string;
  exercise_id: string;
  position: number;
  target_reps: number | null;
  target_load_kg: string | null;
  reps: number | null;
  load_kg: string | null;
  rpe: string | null;
  warmup: boolean;
  custom_values: CustomValues;
  duration_seconds: string | null;
  distance_meters: string | null;
  logged_at: Date | null;
};
type Previous = { exercise_id: string; reps: number | null; load_kg: string | null; rpe: string | null; day: string };

function isLogged(set: SetRow) {
  return Boolean(set.logged_at || set.reps !== null || set.duration_seconds !== null ||
    set.distance_meters !== null || Object.keys(set.custom_values).length);
}

function summarizeSet(reps: number | null, load: string | null, rpe: string | null = null) {
  return [
    reps !== null ? `${reps} reps` : "",
    load !== null ? `${Number(load)} kg` : "",
    rpe !== null ? `RPE ${Number(rpe)}` : "",
  ].filter(Boolean).join(" · ");
}

function TargetFields({ reps, load }: { reps?: number | null; load?: string | null }) {
  return (
    <div className={styles.fields}>
      <label>Target load (kg)<input type="number" inputMode="decimal" name="load_kg" min={0} step="any" defaultValue={load ?? undefined} /></label>
      <label>Target reps<input type="number" inputMode="numeric" name="reps" min={1} step={1} defaultValue={reps ?? undefined} /></label>
    </div>
  );
}

export default async function WorkoutAdminPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireOwner();
  let id: string;
  try {
    id = idInput((await params).id);
  } catch {
    notFound();
  }

  const [{ rows: [workout] }, { rows: exercises }, { rows: sets }, { rows: fields }, { error }] = await Promise.all([
    query<Workout>("SELECT id, title, local_day::text AS day, status, notes FROM workouts WHERE id = $1", [id]),
    query<Exercise>("SELECT id, name, type, primary_muscle FROM exercises ORDER BY name"),
    query<SetRow>("SELECT * FROM workout_sets WHERE workout_id = $1 ORDER BY position, id", [id]),
    query<AdminField>("SELECT id, label, unit, kind, exercise_id FROM field_definitions ORDER BY label"),
    searchParams,
  ]);
  if (!workout) notFound();

  const template = workout.status === "template";
  const completed = workout.status === "completed";
  const loggedCount = sets.filter(isLogged).length;
  const nextSet = sets.find((set) => !isLogged(set));
  const history = template ? [] : (await query<Previous>(
    `SELECT DISTINCT ON (s.exercise_id) s.exercise_id, s.reps, s.load_kg, s.rpe, w.local_day::text AS day
     FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
     WHERE w.status = 'completed' AND w.id <> $1 AND w.local_day <= $2::date
       AND s.exercise_id = ANY($3::uuid[]) AND s.reps IS NOT NULL AND NOT s.warmup
     ORDER BY s.exercise_id, w.local_day DESC, s.logged_at DESC NULLS LAST, s.position DESC`,
    [id, workout.day, [...new Set(sets.map((set) => set.exercise_id))]],
  )).rows;
  const previousSets = new Map(history.map((set) => [set.exercise_id, set]));
  const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const addSet = saveSet.bind(null, id, null);
  const workoutTitle = template ? "Template" : completed ? "Completed workout" : "Scheduled workout";

  return (
    <>
      <nav aria-label="Workout tools" className={styles.nav}><Link href="/admin">Training admin</Link>
        {completed && <Link href={`/training/${id}`}>View public workout</Link>}
      </nav>
      <p className={styles.kicker}>{workoutTitle}{workout.day && ` · ${workout.day}`}</p>
      <h1>{workout.title}</h1>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="sets-heading">
          <h2 id="sets-heading">{template ? "Target sets" : "Sets"}</h2>
          {!template && sets.length > 0 && <p>{loggedCount} of {sets.length} sets logged</p>}
          {sets.map((set, index) => {
            const exercise = exercisesById.get(set.exercise_id)!;
            const logged = isLogged(set);
            const previous = previousSets.get(exercise.id);
            const previousSummary = previous && summarizeSet(previous.reps, previous.load_kg, previous.rpe);
            const target = summarizeSet(set.target_reps, set.target_load_kg);
            const actual = [
              summarizeSet(set.reps, set.load_kg, set.rpe),
              set.duration_seconds !== null ? `${Number(set.duration_seconds)} s` : "",
              set.distance_meters !== null ? `${Number(set.distance_meters)} m` : "",
            ].filter(Boolean).join(" · ");
            const setFields = fields.filter((field) => !field.exercise_id || field.exercise_id === exercise.id);
            const save = saveSet.bind(null, id, set.id);
            const version = JSON.stringify(set);
            return (
              <details id={`set-${set.id}`} className={styles.set} key={set.id}
                open={(!template && set.id === nextSet?.id) || undefined}>
                <summary>
                  <strong>{exercise.name}</strong>
                  <small>Set {index + 1}{set.warmup ? " · Warm-up" : ""}{logged ? " · Logged" : ""}</small>
                  {(logged ? actual : target) && <small>{logged ? actual : target}</small>}
                </summary>
                {!template && (
                  <>
                    {previousSummary && <p className={styles.lastSet}>Last session · {previousSummary}</p>}
                    <SetDraftForm key={version} setId={set.id} version={version} action={save}>
                      <input type="hidden" name="mode" value="actual" />
                      <SetFields exercise={exercise} fields={setFields} values={{
                        reps: logged ? set.reps : set.target_reps,
                        load: logged ? set.load_kg : set.target_load_kg,
                        rpe: set.rpe, duration: set.duration_seconds, distance: set.distance_meters, custom: set.custom_values,
                      }} />
                      <label className={styles.check}><input type="checkbox" name="warmup" defaultChecked={set.warmup} /> Warm-up set</label>
                      <div className={styles.actions}><button>{logged ? "Save set" : "Log set"}</button></div>
                    </SetDraftForm>
                  </>
                )}
                {!completed && (template ? (
                  <form action={save} className={styles.form}>
                    <input type="hidden" name="mode" value="target" />
                    <TargetFields reps={set.target_reps} load={set.target_load_kg} />
                    <label className={styles.check}><input type="checkbox" name="warmup" defaultChecked={set.warmup} /> Warm-up set</label>
                    <div className={styles.actions}><button>Save target</button></div>
                  </form>
                ) : (
                  <details className={styles.toggle}>
                    <summary>Edit target</summary>
                    <form action={save} className={styles.form}>
                      <input type="hidden" name="mode" value="target" />
                      <TargetFields reps={set.target_reps} load={set.target_load_kg} />
                      <label className={styles.check}><input type="checkbox" name="warmup" defaultChecked={set.warmup} /> Warm-up set</label>
                      <div className={styles.actions}><button>Save target</button></div>
                    </form>
                  </details>
                ))}
                {(!completed || loggedCount > 1 || !logged) && (
                  <form action={removeSet.bind(null, id, set.id)} className={styles.actions}>
                    <button className={styles.secondaryButton}>Remove set</button>
                  </form>
                )}
              </details>
            );
          })}

          {exercises.length === 0 ? (
            <p><Link href="/admin#exercises">Add an exercise to start building the workout</Link>.</p>
          ) : (
            <>
              {!template && (
                <details className={styles.toggle} open={!sets.length && !completed || undefined}>
                  <summary>Add a logged set</summary>
                  <NewActualSet action={addSet} exercises={exercises} fields={fields} submissionId={randomUUID()} />
                </details>
              )}
              {!completed && (
                <details className={styles.toggle} open={template && !sets.length || undefined}>
                  <summary>Add target sets</summary>
                  <form action={addSet} className={styles.form}>
                    <input type="hidden" name="mode" value="target" />
                    <label>Exercise
                      <select name="exercise_id" required>
                        {exercises.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    </label>
                    <TargetFields />
                    <label>Number of identical sets<input type="number" inputMode="numeric" name="count" min={1} max={20} defaultValue={1} required /></label>
                    <label className={styles.check}><input type="checkbox" name="warmup" /> Warm-up sets</label>
                    <div className={styles.actions}><button>Add sets</button></div>
                  </form>
                </details>
              )}
            </>
          )}
        </section>
        <section className={styles.section} aria-labelledby="workout-heading">
          <h2 id="workout-heading">Workout details</h2>
          <form action={updateWorkout.bind(null, id)} className={styles.form}>
            <label>Name<input name="title" maxLength={120} defaultValue={workout.title} required /></label>
            {!template && <label>Date<input name="local_day" type="date" defaultValue={workout.day ?? undefined} required /></label>}
            <label>{template ? "Template notes" : "Workout notes (public once completed)"}
              <textarea name="notes" rows={4} maxLength={4000} defaultValue={workout.notes} />
            </label>
            <div className={styles.actions}><button className={styles.secondaryButton}>Save details</button></div>
          </form>
          {!template && !completed && loggedCount > 0 && (
            <form action={completeWorkout.bind(null, id)} className={styles.form}>
              <p>Completing the workout publishes its logged sets and notes.</p>
              <div className={styles.actions}><button>Complete workout</button></div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
