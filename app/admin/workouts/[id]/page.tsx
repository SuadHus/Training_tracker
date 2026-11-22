import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "../../../../src/lib/db";
import { requireOwner } from "../../../../src/lib/owner";
import { groupExerciseSets, idInput, trainingDay, type CustomValues } from "../../../../src/lib/training-admin";
import { displayDay, numberLabel, valueForField } from "../../../../src/lib/training-public";
import { completeWorkout, createWorkout, duplicateSet, moveExercise, removeSet, saveAsTemplate, saveSet, updateWorkout } from "../../actions";
import { NewActualSet, NextSetLink, SetDraftForm, SetFields, type AdminField, type SetPreset } from "../../set-form";
import { WorkoutSubmit } from "../../workout-submit";
import styles from "../workout.module.css";

type Workout = { id: string; title: string; day: string | null; status: "planned" | "template" | "completed"; notes: string };
type Exercise = { id: string; name: string; type: string; primary_muscle: string };
type Metrics = {
  reps: number | null;
  load_kg: string | null;
  rpe: string | null;
  duration_seconds: string | null;
  distance_meters: string | null;
  custom_values: CustomValues;
};
type SetRow = Metrics & {
  id: string;
  exercise_id: string;
  position: number;
  target_reps: number | null;
  target_load_kg: string | null;
  warmup: boolean;
  logged_at: Date | null;
};
type Previous = Metrics & { exercise_id: string; day: string };

function isLogged(set: SetRow) {
  return Boolean(set.logged_at || set.reps !== null || set.duration_seconds !== null ||
    set.distance_meters !== null || Object.keys(set.custom_values).length);
}

function measurements(reps: number | null, load: string | null) {
  return [
    reps !== null ? `${numberLabel.format(reps)} reps` : "",
    load !== null ? `${numberLabel.format(Number(load))} kg` : "",
  ].filter(Boolean);
}

function actualSummary(set: Metrics, fields: AdminField[]) {
  return [
    ...measurements(set.reps, set.load_kg),
    set.duration_seconds !== null ? `${numberLabel.format(Number(set.duration_seconds))} s` : "",
    set.distance_meters !== null ? `${numberLabel.format(Number(set.distance_meters))} m` : "",
    set.rpe !== null ? `RPE ${numberLabel.format(Number(set.rpe))}` : "",
    ...fields.flatMap(({ id, label, unit }) => {
      const value = valueForField(set.custom_values, id, unit);
      return value === null ? [] : [`${label} ${value}`];
    }),
  ].filter(Boolean).join(" · ");
}

function presetFrom(set: Metrics | undefined, label: string): SetPreset | undefined {
  if (!set || [set.reps, set.load_kg, set.duration_seconds, set.distance_meters].every((metric) => metric === null)) return undefined;
  return {
    label,
    values: { reps: set.reps, load: set.load_kg, duration: set.duration_seconds, distance: set.distance_meters },
  };
}

function TargetFields({ reps, load }: { reps?: number | null; load?: string | null }) {
  return (
    <div className={styles.fields}>
      <label>Target load (kg)<input type="number" inputMode="decimal" name="load_kg" min={0} max={100000} step="any" defaultValue={load ?? undefined} /></label>
      <label>Target reps<input type="number" inputMode="numeric" name="reps" min={1} max={100000} step={1} defaultValue={reps ?? undefined} /></label>
    </div>
  );
}

function TargetForm({ action, exercises, afterSetId }: {
  action: (form: FormData) => Promise<void>;
  exercises: Exercise[];
  afterSetId?: string;
}) {
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="mode" value="target" />
      <input type="hidden" name="submission_id" value={randomUUID()} />
      {afterSetId ? <>
        <input type="hidden" name="after_set_id" value={afterSetId} />
        <input type="hidden" name="exercise_id" value={exercises[0].id} />
      </> : (
        <label>Exercise
          <select name="exercise_id" required>
            {exercises.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      )}
      <TargetFields />
      <label>Number of sets<input type="number" inputMode="numeric" name="count" min={1} max={20} defaultValue={1} required /></label>
      <div className={styles.actions}>
        <label className={styles.check}><input type="checkbox" name="warmup" /> Warm-up</label>
        <WorkoutSubmit>Add target sets</WorkoutSubmit>
      </div>
    </form>
  );
}

function TargetEditor({ action, set }: { action: (form: FormData) => Promise<void>; set: SetRow }) {
  return (
    <form action={action} className={styles.form} key={`${set.target_reps}:${set.target_load_kg}:${set.warmup}`}>
      <input type="hidden" name="mode" value="target" />
      <TargetFields reps={set.target_reps} load={set.target_load_kg} />
      <div className={styles.actions}>
        <label className={styles.check}><input type="checkbox" name="warmup" defaultChecked={set.warmup} /> Warm-up</label>
        <WorkoutSubmit>Save target</WorkoutSubmit>
      </div>
    </form>
  );
}

function TemplateStart({ id, today }: { id: string; today: string }) {
  return (
    <section className={styles.card} id="use-template">
      <h2>Use this template</h2>
      <form action={createWorkout} className={styles.form}>
        <input type="hidden" name="status" value="planned" />
        <input type="hidden" name="template_id" value={id} />
        <input type="hidden" name="timing" value="today" />
        <input type="hidden" name="submission_id" value={randomUUID()} />
        <WorkoutSubmit className={styles.wideButton}>Start workout today</WorkoutSubmit>
      </form>
      <details className={styles.extras}>
        <summary>Schedule for another date</summary>
        <form action={createWorkout} className={styles.form}>
          <input type="hidden" name="status" value="planned" />
          <input type="hidden" name="template_id" value={id} />
          <input type="hidden" name="submission_id" value={randomUUID()} />
          <label>Date<input type="date" name="local_day" defaultValue={today} required /></label>
          <WorkoutSubmit className={styles.secondary}>Schedule workout</WorkoutSubmit>
        </form>
      </details>
    </section>
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

  const today = trainingDay();
  const template = workout.status === "template";
  const completed = workout.status === "completed";
  const loggedCount = sets.filter(isLogged).length;
  const displayCount = completed ? loggedCount : sets.length;
  const nextSet = completed ? undefined : sets.find((set) => !isLogged(set));
  const groups = groupExerciseSets(sets);
  const exerciseCount = new Set(sets.map((set) => set.exercise_id)).size;
  const history = template || exercises.length === 0 ? [] : (await query<Previous>(
    `SELECT DISTINCT ON (s.exercise_id) s.exercise_id, s.reps, s.load_kg, s.rpe, s.duration_seconds,
      s.distance_meters, s.custom_values, w.local_day::text AS day
     FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
     WHERE w.status = 'completed' AND w.id <> $1 AND w.local_day <= $2::date
       AND s.exercise_id = ANY($3::uuid[]) AND NOT s.warmup
       AND (s.reps IS NOT NULL OR s.duration_seconds IS NOT NULL OR s.distance_meters IS NOT NULL OR s.custom_values <> '{}'::jsonb)
     ORDER BY s.exercise_id, w.local_day DESC, s.logged_at DESC NULLS LAST, s.position DESC, s.id`,
    [id, workout.day, exercises.map(({ id }) => id)],
  )).rows;
  const previousSets = new Map(history.map((set) => [set.exercise_id, set]));
  const priorPresets = Object.fromEntries(history.flatMap((set) => {
    const preset = presetFrom(set, "Use last session’s values");
    return preset ? [[set.exercise_id, preset] as const] : [];
  }));
  const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const addSet = saveSet.bind(null, id, null);
  const status = template ? "Workout template" : completed ? "Completed workout" : workout.day === today ? "Today’s session" : "Scheduled workout";
  const canComplete = !template && !completed && loggedCount > 0 && workout.day !== null && workout.day <= today;

  return (
    <div className={styles.workspace}>
      <nav aria-label="Workout tools" className={styles.tools}>
        <Link href="/admin"><span aria-hidden="true">←</span> Workspace</Link>
        {completed && <Link href={`/training/${id}`}>View public workout <span aria-hidden="true">↗</span></Link>}
      </nav>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{status}</p>
          <h1>{workout.title}</h1>
          <p className={styles.meta}>
            {workout.day && <><time dateTime={workout.day}>{displayDay(workout.day)}</time> · </>}
            {exerciseCount} {exerciseCount === 1 ? "exercise" : "exercises"} · {displayCount}
            {template ? " target" : completed ? " logged" : ""} {displayCount === 1 ? "set" : "sets"}
          </p>
        </div>
        {template && <a href="#use-template" className={styles.jump}>Use this template <span aria-hidden="true">↘</span></a>}
        {canComplete && <a href="#finish-workout" className={styles.jump}>Finish workout <span aria-hidden="true">↘</span></a>}
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!template && !completed && sets.length > 0 && (
        <div className={styles.progress}>
          <div className={styles.progressLabel}>
            <div className={styles.progressData}>
              <strong>{loggedCount} of {sets.length} sets logged</strong>
              <progress aria-label="Sets logged" className={styles.progressBar} value={loggedCount} max={sets.length} />
            </div>
          </div>
          {nextSet && <NextSetLink setId={nextSet.id} exerciseName={exercisesById.get(nextSet.exercise_id)!.name} />}
        </div>
      )}

      <div className={styles.grid}>
        <section aria-labelledby="sets-heading">
          <div className={styles.heading}><h2 id="sets-heading">{template ? "Exercise plan" : "Session log"}</h2></div>
          <div className={styles.stack}>
            {groups.length > 0 && <ol className={styles.groups}>
              {groups.map((group, groupIndex) => {
                const first = group[0];
                const above = groups[groupIndex - 1]?.[0].id ?? null;
                const below = groups[groupIndex + 1]?.[0].id ?? null;
                const last = group[group.length - 1];
                const exercise = exercisesById.get(first.exercise_id)!;
                const previous = previousSets.get(exercise.id);
                const setFields = fields.filter((field) => !field.exercise_id || field.exercise_id === exercise.id);
                const previousSummary = previous && actualSummary(previous, setFields);
                const groupLogged = group.filter(isLogged).length;
                const recentSet = group.findLast(isLogged);
                const addPreset = presetFrom(recentSet, "Use last set’s values") ?? priorPresets[exercise.id];

                return <li key={first.id} className={styles.group}>
                  <div className={styles.groupTop}>
                    <div>
                      <h3>{exercise.name}</h3>
                      <small className={styles.quiet}>{exercise.primary_muscle} · {template
                        ? `${group.length} ${group.length === 1 ? "set" : "sets"}`
                        : `${groupLogged}/${group.length} logged`}</small>
                    </div>
                    {!completed && groups.length > 1 && <div className={styles.actions}>
                      <form action={moveExercise.bind(null, id, first.id, "up", above)}>
                        <WorkoutSubmit className={styles.iconButton} label={`Move ${exercise.name} up`} disabled={above === null}>↑</WorkoutSubmit>
                      </form>
                      <form action={moveExercise.bind(null, id, first.id, "down", below)}>
                        <WorkoutSubmit className={styles.iconButton} label={`Move ${exercise.name} down`} disabled={below === null}>↓</WorkoutSubmit>
                      </form>
                    </div>}
                  </div>
                  {previous && previousSummary && <p className={styles.history}>
                    <span className={styles.metricLabel}>Last session</span>
                    <strong>{previousSummary}</strong>
                    <time className={styles.quiet} dateTime={previous.day}>{displayDay(previous.day)}</time>
                  </p>}
                  {group.map((set, index) => {
                    const logged = isLogged(set);
                    const next = !template && set.id === nextSet?.id;
                    const target = measurements(set.target_reps, set.target_load_kg).join(" · ");
                    const actual = logged ? actualSummary(set, setFields) : "";
                    const save = saveSet.bind(null, id, set.id);
                    const { position: _position, ...draftSet } = set;
                    const version = JSON.stringify(draftSet);
                    const previousInGroup = group.slice(0, index).findLast((candidate) => isLogged(candidate) && candidate.warmup === set.warmup);
                    const preset = presetFrom(previousInGroup, "Use last set’s values") ?? priorPresets[exercise.id];

                    return <details key={set.id} id={`set-${set.id}`} className={`${styles.setRow} ${next ? styles.next : ""}`} open={next || undefined}>
                      <summary className={styles.row}>
                        <span className={`${styles.setMark} ${logged ? styles.loggedMark : ""}`} aria-hidden="true">
                          {logged ? "✓" : next ? "→" : ""}
                        </span>
                        <span className={styles.rowName}>
                          Set {index + 1}
                          {set.warmup && <small className={styles.quiet}>Warm-up</small>}
                        </span>
                        <span className={styles.rowValue}>
                          <small className={styles.metricLabel}>{logged ? "Logged" : template || target ? "Target" : "Unlogged"}</small>
                          <span className={styles.rowSummary}>{logged ? (actual || "Saved") : target || "Open target"}</span>
                        </span>
                        <span aria-hidden="true" className={styles.chevron} />
                      </summary>
                      <div className={styles.rowBody}>
                        {template ? <TargetEditor action={save} set={set} /> : (
                          <>
                            {logged && target && <p><span className={styles.metricLabel}>Target</span> {target}</p>}
                            <SetDraftForm key={version} setId={set.id} version={version} action={save}>
                              <input type="hidden" name="mode" value="actual" />
                              {!logged && !completed && <input type="hidden" name="advance" value="1" />}
                              <SetFields exercise={exercise} fields={setFields} preset={logged ? undefined : preset} values={{
                                reps: logged ? set.reps : set.target_reps,
                                load: logged ? set.load_kg : set.target_load_kg,
                                rpe: set.rpe, duration: set.duration_seconds, distance: set.distance_meters, custom: set.custom_values,
                              }} />
                              <div className={styles.actions}>
                                <label className={styles.check}><input type="checkbox" name="warmup" defaultChecked={set.warmup} /> Warm-up</label>
                                <WorkoutSubmit>{logged ? "Save set" : "Log set"}</WorkoutSubmit>
                              </div>
                            </SetDraftForm>
                            {!completed && <details className={styles.extras}>
                              <summary>Edit target</summary>
                              <TargetEditor action={save} set={set} />
                            </details>}
                          </>
                        )}
                        <div className={styles.actions}>
                          {(!completed || logged) && <form action={duplicateSet.bind(null, id, set.id)}>
                            <input type="hidden" name="submission_id" value={randomUUID()} />
                            {logged && !completed && <input type="hidden" name="advance" value="1" />}
                            <WorkoutSubmit className={styles.textButton}>{logged ? "Log identical set" : "Duplicate set"}</WorkoutSubmit>
                          </form>}
                          {(!completed || loggedCount > 1 || !logged) && (
                            <form action={removeSet.bind(null, id, set.id)}>
                              <WorkoutSubmit className={`${styles.textButton} ${styles.destructive}`}>Remove set</WorkoutSubmit>
                            </form>
                          )}
                        </div>
                      </div>
                    </details>;
                  })}
                  {template ? (
                    <details className={styles.groupMore}>
                      <summary>Add more target sets</summary>
                      <TargetForm action={addSet} exercises={[exercise]} afterSetId={last.id} />
                    </details>
                  ) : (
                    <details className={styles.groupMore}>
                      <summary>Log another {exercise.name} set</summary>
                      <NewActualSet key={last.id} action={addSet} exercises={[exercise]} fields={fields} submissionId={randomUUID()} afterSetId={last.id} advance={!completed}
                        presets={addPreset ? { [exercise.id]: addPreset } : undefined} />
                    </details>
                  )}
                </li>;
              })}
            </ol>}
            {exercises.length === 0 ? (
              <p className={styles.empty}><Link href="/admin#exercises">Add an exercise to your library</Link> to start {template ? "building the template" : "logging sets"}.</p>
            ) : (
              <>
                {!template && <details className={styles.addPanel} open={sets.length === 0 || undefined}>
                  <summary>Log a set for any exercise</summary>
                  <NewActualSet action={addSet} exercises={exercises} fields={fields} submissionId={randomUUID()} presets={priorPresets} advance={!completed} />
                </details>}
                {!completed && <details className={styles.addPanel} open={template && sets.length === 0 || undefined}>
                  <summary>{template ? "Add an exercise and target sets" : "Add planned sets"}</summary>
                  <TargetForm action={addSet} exercises={exercises} />
                </details>}
              </>
            )}
          </div>
        </section>
        <aside className={styles.stack} aria-label={template ? "Template tools" : "Session tools"}>
          {template && <TemplateStart id={id} today={today} />}
          {!template && !completed && loggedCount > 0 && (
            <section className={styles.card} id="finish-workout">
              <h2>Finish workout</h2>
              {canComplete ? <form action={completeWorkout.bind(null, id)} className={styles.form}>
                <p className={styles.quiet}>Publish {loggedCount} logged {loggedCount === 1 ? "set" : "sets"} and workout notes{sets.length > loggedCount ? ". Unlogged sets stay private." : "."}</p>
                <WorkoutSubmit>Complete and publish</WorkoutSubmit>
              </form> : <p className={styles.quiet}>Set the workout date to today or earlier to publish.</p>}
            </section>
          )}
          <section className={styles.card}>
            <h2>{template ? "Template details" : "Workout details"}</h2>
            <form action={updateWorkout.bind(null, id)} className={styles.form}>
              <label>Name<input name="title" maxLength={120} defaultValue={workout.title} required /></label>
              {!template && <label>Date<input name="local_day" type="date" defaultValue={workout.day ?? undefined} required /></label>}
              <label>{template ? "Template notes" : "Workout notes"}
                <textarea name="notes" rows={3} maxLength={4000} defaultValue={workout.notes} />
              </label>
              {!template && <small className={styles.quiet}>{completed ? "Notes are visible on the public workout." : "Notes are published when you complete the workout."}</small>}
              <WorkoutSubmit className={styles.secondary}>Save details</WorkoutSubmit>
            </form>
          </section>
          {!template && sets.length > 0 && <section className={styles.card}>
            <h2>Reuse this workout</h2>
            <p className={styles.quiet}>Start a template with its exercise order, reps and loads.</p>
            <details className={styles.extras}>
              <summary>Save as template</summary>
              <form action={saveAsTemplate.bind(null, id)} className={styles.form}>
                <input type="hidden" name="submission_id" value={randomUUID()} />
                <label>Template name<input name="title" maxLength={120} defaultValue={workout.title} required /></label>
                <WorkoutSubmit className={styles.secondary}>Save template</WorkoutSubmit>
              </form>
            </details>
          </section>}
        </aside>
      </div>
    </div>
  );
}
