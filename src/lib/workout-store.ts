// Everything the owner's pages read and write about workouts, exercises and fields.
// Server only: this module talks to the database.
import { query, transaction } from "./db";
import {
  EQUIPMENT, TRACKINGS, WorkoutInputError, isDay, isId, limits, parseWorkoutDraft, rejectNul, stockholmDay,
  type BlockDoc, type Equipment, type ExerciseInfo, type FieldInfo, type FieldKind, type Measures, type SetDoc,
  type Tracking, type WorkoutDoc, type WorkoutStatus,
} from "./workout-doc";
import type { ExerciseHistory } from "./workout-edit";

type Run = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

// Exercises and fields --------------------------------------------------------

const exerciseColumns = `e.id, e.name, e.tracking, e.equipment, e.bar_kg::float8 AS bar_kg, e.rest_seconds,
  e.primary_muscle, e.secondary_muscles, e.notes, (e.archived_at IS NOT NULL) AS archived`;

type ExerciseRow = {
  id: string; name: string; tracking: Tracking; equipment: Equipment; bar_kg: number | null; rest_seconds: number | null;
  primary_muscle: string; secondary_muscles: string[]; notes: string; archived: boolean;
};

function exerciseFrom(row: ExerciseRow): ExerciseInfo {
  return {
    id: row.id, name: row.name, tracking: row.tracking, equipment: row.equipment, barKg: row.bar_kg,
    restSeconds: row.rest_seconds, primaryMuscle: row.primary_muscle, secondaryMuscles: row.secondary_muscles,
    notes: row.notes, archived: row.archived,
  };
}

export async function listExercises(options: { includeArchived?: boolean } = {}): Promise<ExerciseInfo[]> {
  const { rows } = await query<ExerciseRow>(
    `SELECT ${exerciseColumns} FROM exercises e
      WHERE ($1::boolean OR e.archived_at IS NULL) ORDER BY lower(e.name), e.id`,
    [options.includeArchived === true],
  );
  return rows.map(exerciseFrom);
}

type FieldRow = { id: string; label: string; unit: string; kind: FieldKind; exercise_id: string | null };

const fieldFrom = (row: FieldRow): FieldInfo => ({
  id: row.id, label: row.label, unit: row.unit, kind: row.kind, exerciseId: row.exercise_id,
});

export async function listFields(): Promise<FieldInfo[]> {
  const { rows } = await query<FieldRow>(
    "SELECT id, label, unit, kind, exercise_id FROM field_definitions ORDER BY lower(label), id",
  );
  return rows.map(fieldFrom);
}

// Loading a workout -----------------------------------------------------------

const measuresFrom = (row: Record<string, number | null>, prefix: string): Measures => ({
  reps: row[`${prefix}reps`], load: row[`${prefix}load`], rpe: row[`${prefix}rpe`],
  duration: row[`${prefix}duration`], distance: row[`${prefix}distance`],
});

async function loadWith(run: Run, id: string): Promise<WorkoutDoc | null> {
  const { rows: [workout] } = await run(
    `SELECT id, status, title, local_day::text AS day, notes, template_id, started_at, completed_at, revision
      FROM workouts WHERE id = $1`, [id],
  );
  if (!workout) return null;
  // One after the other: inside a transaction both run on a single connection.
  const { rows: blocks } = await run(
    `SELECT id, exercise_id, notes, rest_seconds FROM workout_exercises
      WHERE workout_id = $1 ORDER BY position, id`, [id],
  );
  const { rows: sets } = await run(
    `SELECT id, workout_exercise_id, warmup, custom_values, logged_at,
        target_reps AS t_reps, target_reps_max AS t_reps_max, target_load_kg::float8 AS t_load,
        target_rpe::float8 AS t_rpe, target_duration_seconds::float8 AS t_duration,
        target_distance_meters::float8 AS t_distance,
        reps AS a_reps, load_kg::float8 AS a_load, rpe::float8 AS a_rpe,
        duration_seconds::float8 AS a_duration, distance_meters::float8 AS a_distance
      FROM workout_sets WHERE workout_id = $1 ORDER BY position, id`, [id],
  );
  const byBlock = new Map<string, SetDoc[]>();
  for (const row of sets) {
    const list = byBlock.get(row.workout_exercise_id) ?? [];
    list.push({
      id: row.id,
      warmup: row.warmup,
      target: { ...measuresFrom(row, "t_"), repsMax: row.t_reps_max },
      actual: measuresFrom(row, "a_"),
      custom: row.custom_values ?? {},
      loggedAt: iso(row.logged_at),
    });
    byBlock.set(row.workout_exercise_id, list);
  }
  return {
    id: workout.id,
    status: workout.status,
    title: workout.title,
    day: workout.day,
    notes: workout.notes,
    templateId: workout.template_id,
    startedAt: iso(workout.started_at),
    completedAt: iso(workout.completed_at),
    revision: workout.revision,
    blocks: blocks.map((block): BlockDoc => ({
      id: block.id, exerciseId: block.exercise_id, notes: block.notes, restSeconds: block.rest_seconds,
      sets: byBlock.get(block.id) ?? [],
    })),
  };
}

const poolRun: Run = (sql, params) => query(sql, params);

export function loadWorkout(id: string): Promise<WorkoutDoc | null> {
  return isId(id) ? loadWith(poolRun, id) : Promise.resolve(null);
}

export async function exerciseHistory(
  exerciseIds: string[], options: { before: string | null; excludeWorkoutId?: string },
): Promise<Record<string, ExerciseHistory>> {
  const ids = exerciseIds.filter(isId);
  if (!ids.length || (options.before !== null && !isDay(options.before))) return {};
  const exclude = isId(options.excludeWorkoutId) ? options.excludeWorkoutId : null;
  const { rows } = await query(
    `WITH ranked AS (
        SELECT s.exercise_id, w.id AS workout_id, w.local_day,
          row_number() OVER (PARTITION BY s.exercise_id ORDER BY w.local_day DESC, max(s.logged_at) DESC, w.id) AS place
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
        WHERE s.exercise_id = ANY($1::uuid[]) AND s.logged_at IS NOT NULL AND w.status = 'completed'
          AND ($2::date IS NULL OR w.local_day <= $2::date) AND ($3::uuid IS NULL OR w.id <> $3::uuid)
        GROUP BY s.exercise_id, w.id, w.local_day
      )
      SELECT r.exercise_id, r.workout_id, r.local_day::text AS day, s.warmup, s.reps AS a_reps,
          s.load_kg::float8 AS a_load, s.rpe::float8 AS a_rpe, s.duration_seconds::float8 AS a_duration,
          s.distance_meters::float8 AS a_distance
        FROM ranked r JOIN workout_sets s
          ON s.workout_id = r.workout_id AND s.exercise_id = r.exercise_id AND s.logged_at IS NOT NULL
        WHERE r.place = 1 ORDER BY r.exercise_id, s.position, s.id`,
    [ids, options.before, exclude],
  );
  const history: Record<string, ExerciseHistory> = {};
  for (const row of rows) {
    const entry = (history[row.exercise_id] ??= { day: row.day, workoutId: row.workout_id, sets: [] });
    entry.sets.push({ warmup: row.warmup, measures: measuresFrom(row, "a_") });
  }
  return history;
}

// Saving ----------------------------------------------------------------------

export type SaveResult =
  | { ok: true; revision: number; startedAt: string | null }
  | { ok: false; reason: "conflict"; current: WorkoutDoc }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "missing" };

const reload = "That change belongs to another session. Reload the page and try again.";

export async function saveWorkout(id: string, baseRevision: number, draft: unknown): Promise<SaveResult> {
  if (!isId(id)) return { ok: false, reason: "missing" };
  try {
    return await transaction<SaveResult>(async (client) => {
      const run: Run = (sql, params) => client.query(sql, params);
      const { rows: [row] } = await run("SELECT status, revision FROM workouts WHERE id = $1 FOR UPDATE", [id]);
      if (!row) return { ok: false, reason: "missing" };
      if (row.revision !== baseRevision) {
        const current = await loadWith(run, id);
        return { ok: false, reason: "conflict", current: current! };
      }
      const status: WorkoutStatus = row.status;
      const { rows: exercises } = await run("SELECT id FROM exercises", []);
      const { rows: fields } = await run("SELECT id, label, unit, kind, exercise_id FROM field_definitions", []);
      const parsed = parseWorkoutDraft(draft, {
        status,
        exerciseIds: new Set<string>(exercises.map((exercise) => exercise.id)),
        fields: fields.map(fieldFrom),
        today: stockholmDay(),
      });

      const blockIds = parsed.blocks.map((block) => block.id);
      await run("DELETE FROM workout_exercises WHERE workout_id = $1 AND id <> ALL($2::uuid[])", [id, blockIds]);
      const upsertedBlocks = await run(
        `INSERT INTO workout_exercises (id, workout_id, exercise_id, position, notes, rest_seconds)
          SELECT b.id, $1::uuid, b.exercise_id, b.position, b.notes, b.rest_seconds
          FROM unnest($2::uuid[], $3::uuid[], $4::int[], $5::text[], $6::int[])
            AS b(id, exercise_id, position, notes, rest_seconds)
          ON CONFLICT (id) DO UPDATE SET exercise_id = EXCLUDED.exercise_id, position = EXCLUDED.position,
            notes = EXCLUDED.notes, rest_seconds = EXCLUDED.rest_seconds
            WHERE workout_exercises.workout_id = EXCLUDED.workout_id`,
        [
          id, blockIds, parsed.blocks.map((block) => block.exerciseId), parsed.blocks.map((_, index) => index),
          parsed.blocks.map((block) => block.notes), parsed.blocks.map((block) => block.restSeconds),
        ],
      );
      if (upsertedBlocks.rowCount !== parsed.blocks.length) throw new WorkoutInputError(reload);

      const flat = parsed.blocks.flatMap((block) => block.sets.map((set) => ({ block, set })));
      const setIds = flat.map(({ set }) => set.id);
      await run("DELETE FROM workout_sets WHERE workout_id = $1 AND id <> ALL($2::uuid[])", [id, setIds]);
      const upsertedSets = await run(
        `INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, position, warmup,
            target_reps, target_reps_max, target_load_kg, target_rpe, target_duration_seconds, target_distance_meters,
            reps, load_kg, rpe, duration_seconds, distance_meters, custom_values, logged_at)
          SELECT s.id, $1::uuid, s.block_id, s.exercise_id, s.position, s.warmup,
            s.t_reps, s.t_reps_max, s.t_load, s.t_rpe, s.t_duration, s.t_distance,
            s.a_reps, s.a_load, s.a_rpe, s.a_duration, s.a_distance, s.custom::jsonb, s.logged_at
          FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::int[], $6::boolean[],
            $7::int[], $8::int[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[],
            $13::int[], $14::numeric[], $15::numeric[], $16::numeric[], $17::numeric[], $18::text[], $19::timestamptz[])
            AS s(id, block_id, exercise_id, position, warmup, t_reps, t_reps_max, t_load, t_rpe, t_duration, t_distance,
              a_reps, a_load, a_rpe, a_duration, a_distance, custom, logged_at)
          ON CONFLICT (id) DO UPDATE SET workout_exercise_id = EXCLUDED.workout_exercise_id,
            exercise_id = EXCLUDED.exercise_id, position = EXCLUDED.position, warmup = EXCLUDED.warmup,
            target_reps = EXCLUDED.target_reps, target_reps_max = EXCLUDED.target_reps_max,
            target_load_kg = EXCLUDED.target_load_kg, target_rpe = EXCLUDED.target_rpe,
            target_duration_seconds = EXCLUDED.target_duration_seconds,
            target_distance_meters = EXCLUDED.target_distance_meters,
            reps = EXCLUDED.reps, load_kg = EXCLUDED.load_kg, rpe = EXCLUDED.rpe,
            duration_seconds = EXCLUDED.duration_seconds, distance_meters = EXCLUDED.distance_meters,
            custom_values = EXCLUDED.custom_values, logged_at = EXCLUDED.logged_at
            WHERE workout_sets.workout_id = EXCLUDED.workout_id`,
        [
          id, setIds, flat.map(({ block }) => block.id), flat.map(({ block }) => block.exerciseId),
          flat.map((_, index) => index + 1), flat.map(({ set }) => set.warmup),
          flat.map(({ set }) => set.target.reps), flat.map(({ set }) => set.target.repsMax),
          flat.map(({ set }) => set.target.load), flat.map(({ set }) => set.target.rpe),
          flat.map(({ set }) => set.target.duration), flat.map(({ set }) => set.target.distance),
          flat.map(({ set }) => set.actual.reps), flat.map(({ set }) => set.actual.load),
          flat.map(({ set }) => set.actual.rpe), flat.map(({ set }) => set.actual.duration),
          flat.map(({ set }) => set.actual.distance), flat.map(({ set }) => JSON.stringify(set.custom)),
          flat.map(({ set }) => set.loggedAt),
        ],
      );
      if (upsertedSets.rowCount !== flat.length) throw new WorkoutInputError(reload);

      const { rows: [saved] } = await run(
        `UPDATE workouts SET title = $2, local_day = $3::date, notes = $4, revision = revision + 1, updated_at = now(),
            started_at = coalesce(started_at, (SELECT min(logged_at) FROM workout_sets WHERE workout_id = $1))
          WHERE id = $1 RETURNING revision, started_at`,
        [id, parsed.title, parsed.day, parsed.notes],
      );
      return { ok: true, revision: saved.revision, startedAt: iso(saved.started_at) };
    });
  } catch (error) {
    if (error instanceof WorkoutInputError) return { ok: false, reason: "invalid", message: error.message };
    throw error;
  }
}

// Creating, copying, finishing, deleting --------------------------------------

const setColumns = `warmup, target_reps, target_reps_max, target_load_kg, target_rpe, target_duration_seconds,
  target_distance_meters`;

export async function createWorkout(
  input: { id?: string; status: "template" | "planned"; title?: string; day?: string | null; templateId?: string | null },
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  if (!isId(id)) throw new WorkoutInputError("The request is not readable. Reload the page and try again.");
  const { rows: [existing] } = await query("SELECT 1 FROM workouts WHERE id = $1", [id]);
  if (existing) return id;
  const planned = input.status === "planned";
  if (planned && !isDay(input.day)) throw new WorkoutInputError("Enter a valid date.");
  const templateId = input.templateId ?? null;
  if (templateId !== null && !isId(templateId)) throw new WorkoutInputError("That template no longer exists.");

  await transaction(async (client) => {
    let title = rejectNul(input.title ?? "", "The name").trim();
    if (templateId) {
      const { rows: [template] } = await client.query(
        "SELECT title FROM workouts WHERE id = $1 AND status = 'template'", [templateId],
      );
      if (!template) throw new WorkoutInputError("That template no longer exists.");
      title ||= template.title;
    }
    if (!title) throw new WorkoutInputError("Give it a name.");
    if (title.length > limits.title) throw new WorkoutInputError(`The name can be at most ${limits.title} characters.`);

    // A template's own notes are planning notes. A session's notes are published
    // with it, so they start empty; the cues on each exercise do carry over.
    const { rowCount } = await client.query(
      `INSERT INTO workouts (id, title, local_day, status, template_id)
        VALUES ($1, $2, $3::date, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, title, planned ? input.day : null, input.status, templateId],
    );
    if (!rowCount || !templateId) return;
    await client.query(
      `WITH map AS (
          SELECT id AS old_id, gen_random_uuid() AS new_id, exercise_id, position, notes, rest_seconds
          FROM workout_exercises WHERE workout_id = $2
        ), blocks AS (
          INSERT INTO workout_exercises (id, workout_id, exercise_id, position, notes, rest_seconds)
          SELECT new_id, $1, exercise_id, position, notes, rest_seconds FROM map
        )
        INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, position, ${setColumns})
        SELECT gen_random_uuid(), $1, m.new_id, m.exercise_id, s.position, s.warmup, s.target_reps, s.target_reps_max,
          s.target_load_kg, s.target_rpe, s.target_duration_seconds, s.target_distance_meters
        FROM workout_sets s JOIN map m ON m.old_id = s.workout_exercise_id`,
      [id, templateId],
    );
  });
  return id;
}

export async function copyToTemplate(workoutId: string, input: { id?: string; title: string }): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  if (!isId(id) || !isId(workoutId)) throw new WorkoutInputError("The request is not readable. Reload the page and try again.");
  const title = rejectNul(String(input.title ?? ""), "The name").trim();
  if (!title) throw new WorkoutInputError("Give the template a name.");
  if (title.length > limits.title) throw new WorkoutInputError(`The name can be at most ${limits.title} characters.`);
  const { rows: [existing] } = await query("SELECT 1 FROM workouts WHERE id = $1", [id]);
  if (existing) return id;

  await transaction(async (client) => {
    const { rows: [source] } = await client.query("SELECT status FROM workouts WHERE id = $1", [workoutId]);
    if (!source) throw new WorkoutInputError("That session no longer exists.");
    if (source.status === "template") throw new WorkoutInputError("That is already a template.");
    const { rowCount: created } = await client.query(
      "INSERT INTO workouts (id, title, status) VALUES ($1, $2, 'template') ON CONFLICT (id) DO NOTHING", [id, title],
    );
    if (!created) return;
    // A logged set becomes the new target; rpe keeps its old target because the effort felt is not a goal.
    const { rowCount } = await client.query(
      `WITH picked AS (
          SELECT * FROM workout_sets
          WHERE workout_id = $2 AND (logged_at IS NOT NULL OR $3::boolean = false)
        ), map AS (
          SELECT b.id AS old_id, gen_random_uuid() AS new_id, b.exercise_id,
            row_number() OVER (ORDER BY b.position, b.id) - 1 AS position, b.notes, b.rest_seconds
          FROM workout_exercises b
          WHERE b.workout_id = $2 AND EXISTS (SELECT 1 FROM picked p WHERE p.workout_exercise_id = b.id)
        ), blocks AS (
          INSERT INTO workout_exercises (id, workout_id, exercise_id, position, notes, rest_seconds)
          SELECT new_id, $1, exercise_id, position, notes, rest_seconds FROM map
        )
        INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, position, warmup, target_reps,
            target_reps_max, target_load_kg, target_rpe, target_duration_seconds, target_distance_meters)
        SELECT gen_random_uuid(), $1, m.new_id, m.exercise_id, row_number() OVER (ORDER BY s.position, s.id), s.warmup,
          CASE WHEN s.logged_at IS NULL THEN s.target_reps ELSE s.reps END,
          CASE WHEN s.logged_at IS NULL THEN s.target_reps_max WHEN s.target_reps_max > s.reps THEN s.target_reps_max END,
          CASE WHEN s.logged_at IS NULL THEN s.target_load_kg ELSE s.load_kg END,
          s.target_rpe,
          CASE WHEN s.logged_at IS NULL THEN s.target_duration_seconds ELSE s.duration_seconds END,
          CASE WHEN s.logged_at IS NULL THEN s.target_distance_meters ELSE s.distance_meters END
        FROM picked s JOIN map m ON m.old_id = s.workout_exercise_id`,
      [id, workoutId, source.status === "completed"],
    );
    if (!rowCount) throw new WorkoutInputError("There are no sets to copy into a template.");
  });
  return id;
}

export async function completeWorkout(id: string): Promise<void> {
  await transaction(async (client) => {
    const { rows: [workout] } = await client.query(
      "SELECT status, local_day::text AS day FROM workouts WHERE id = $1 FOR UPDATE", [isId(id) ? id : null],
    );
    if (!workout) throw new WorkoutInputError("That session no longer exists.");
    if (workout.status === "completed") return;
    if (workout.status === "template") throw new WorkoutInputError("A template cannot be finished. Start a session from it.");
    const { rows: [logged] } = await client.query(
      "SELECT count(*)::int AS count FROM workout_sets WHERE workout_id = $1 AND logged_at IS NOT NULL", [id],
    );
    if (!logged.count) throw new WorkoutInputError("Log at least one set before finishing the session.");
    if (workout.day > stockholmDay()) {
      throw new WorkoutInputError(`This session is dated ${workout.day}, which is in the future. Change the date to today or earlier, then finish it.`);
    }
    await client.query(
      `UPDATE workouts SET status = 'completed', completed_at = now(), revision = revision + 1, updated_at = now(),
          started_at = coalesce(started_at, (SELECT min(logged_at) FROM workout_sets WHERE workout_id = $1))
        WHERE id = $1`, [id],
    );
  });
}

export async function reopenWorkout(id: string): Promise<void> {
  await query(
    `UPDATE workouts SET status = 'planned', completed_at = NULL, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND status = 'completed'`, [isId(id) ? id : null],
  );
}

export async function deleteWorkout(id: string): Promise<void> {
  await query("DELETE FROM workouts WHERE id = $1", [isId(id) ? id : null]);
}

// The desk --------------------------------------------------------------------

export type DeskWorkout = {
  id: string; title: string; day: string; status: "planned" | "completed"; exerciseCount: number; setCount: number;
  loggedCount: number; startedAt: string | null; createdAt: string; exercises: string[];
};
export type DeskTemplate = {
  id: string; title: string; notes: string; exerciseCount: number; setCount: number; exercises: string[];
  lastUsed: string | null; timesUsed: number;
};
export type DeskData = {
  today: string; inProgress: DeskWorkout[]; todayPlanned: DeskWorkout[]; overdue: DeskWorkout[];
  upcoming: DeskWorkout[]; templates: DeskTemplate[]; recent: DeskWorkout[];
  counts: { exercises: number; completed: number };
};

const MOST_EXERCISES_SHOWN = 6;
// A template counts as used by sessions that were actually trained, not by ones only planned.
const trained = "(u.status = 'completed' OR u.started_at IS NOT NULL)";

export async function deskData(): Promise<DeskData> {
  const today = stockholmDay();
  const [{ rows: workouts }, { rows: templates }, { rows: [counts] }] = await Promise.all([
    query(
      `WITH picked AS (
          SELECT id FROM workouts WHERE status = 'planned'
          UNION ALL
          (SELECT id FROM workouts WHERE status = 'completed' ORDER BY local_day DESC, started_at DESC NULLS LAST, id LIMIT 10)
        )
        SELECT w.id, w.title, w.local_day::text AS day, w.status, w.started_at, w.created_at,
            (SELECT count(*) FROM workout_exercises b WHERE b.workout_id = w.id)::int AS exercise_count,
            count(s.id)::int AS set_count, count(s.logged_at)::int AS logged_count
          FROM picked p JOIN workouts w ON w.id = p.id LEFT JOIN workout_sets s ON s.workout_id = w.id
          GROUP BY w.id`,
    ),
    query(
      `SELECT t.id, t.title, t.notes,
          (SELECT count(*) FROM workout_exercises b WHERE b.workout_id = t.id)::int AS exercise_count,
          (SELECT count(*) FROM workout_sets s WHERE s.workout_id = t.id)::int AS set_count,
          (SELECT max(u.local_day) FROM workouts u WHERE u.template_id = t.id AND ${trained})::text AS last_used,
          (SELECT count(*) FROM workouts u WHERE u.template_id = t.id AND ${trained})::int AS times_used
        FROM workouts t WHERE t.status = 'template'`,
    ),
    query(
      `SELECT (SELECT count(*) FROM exercises WHERE archived_at IS NULL)::int AS exercises,
          (SELECT count(*) FROM workouts WHERE status = 'completed')::int AS completed`,
    ),
  ]);

  const { rows: names } = await query(
    `SELECT b.workout_id, e.name FROM workout_exercises b JOIN exercises e ON e.id = b.exercise_id
      WHERE b.workout_id = ANY($1::uuid[]) ORDER BY b.workout_id, b.position, b.id`,
    [[...workouts, ...templates].map((row) => row.id)],
  );
  const namesOf = new Map<string, string[]>();
  for (const { workout_id, name } of names) {
    const list = namesOf.get(workout_id) ?? [];
    if (!list.includes(name) && list.length < MOST_EXERCISES_SHOWN) list.push(name);
    namesOf.set(workout_id, list);
  }

  const desk = workouts.map((row): DeskWorkout => ({
    id: row.id, title: row.title, day: row.day, status: row.status, exerciseCount: row.exercise_count,
    setCount: row.set_count, loggedCount: row.logged_count, startedAt: iso(row.started_at),
    createdAt: row.created_at.toISOString(), exercises: namesOf.get(row.id) ?? [],
  }));
  const newestFirst = (a: DeskWorkout, b: DeskWorkout) =>
    b.day.localeCompare(a.day) || (b.startedAt ?? "").localeCompare(a.startedAt ?? "") || a.id.localeCompare(b.id);
  const planned = desk.filter((workout) => workout.status === "planned");
  const idle = planned.filter((workout) => workout.loggedCount === 0);

  return {
    today,
    inProgress: planned.filter((workout) => workout.loggedCount > 0).sort(newestFirst),
    todayPlanned: idle.filter((workout) => workout.day === today).sort(newestFirst),
    overdue: idle.filter((workout) => workout.day < today).sort(newestFirst),
    upcoming: idle.filter((workout) => workout.day > today).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)),
    templates: templates.map((row): DeskTemplate => ({
      id: row.id, title: row.title, notes: row.notes, exerciseCount: row.exercise_count, setCount: row.set_count,
      exercises: namesOf.get(row.id) ?? [], lastUsed: row.last_used, timesUsed: row.times_used,
    })).sort((a, b) =>
      (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") || a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
      a.id.localeCompare(b.id)),
    recent: desk.filter((workout) => workout.status === "completed").sort(newestFirst).slice(0, 10),
    counts: { exercises: counts.exercises, completed: counts.completed },
  };
}

// The exercise library --------------------------------------------------------

export type ExerciseUsage = ExerciseInfo & {
  sessions: number;
  lastDay: string | null;
  best: { load: number; reps: number; estimate: number } | null;
  /** Fields scoped to this exercise; fields offered for every exercise are not counted. */
  fieldCount: number;
};

export async function exerciseLibrary(): Promise<ExerciseUsage[]> {
  const { rows } = await query<ExerciseRow & Record<string, any>>(
    `SELECT ${exerciseColumns}, coalesce(u.sessions, 0)::int AS sessions, u.last_day,
        b.load AS best_load, b.reps AS best_reps, b.estimate AS best_estimate,
        (SELECT count(*) FROM field_definitions f WHERE f.exercise_id = e.id)::int AS field_count
      FROM exercises e
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT w.id) AS sessions, max(w.local_day)::text AS last_day
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id AND w.status = 'completed'
        WHERE s.exercise_id = e.id AND s.logged_at IS NOT NULL
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT s.load_kg::float8 AS load, s.reps,
          (s.load_kg * CASE WHEN s.reps = 1 THEN 1 ELSE 1 + s.reps / 30.0 END)::float8 AS estimate
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id AND w.status = 'completed'
        WHERE s.exercise_id = e.id AND s.logged_at IS NOT NULL AND NOT s.warmup AND s.load_kg > 0
          AND s.reps BETWEEN 1 AND 10 AND e.tracking = 'weight_reps'
        ORDER BY estimate DESC, w.local_day DESC, s.id LIMIT 1
      ) b ON true
      ORDER BY lower(e.name), e.id`,
  );
  return rows.map((row) => ({
    ...exerciseFrom(row),
    sessions: row.sessions,
    lastDay: row.last_day,
    best: row.best_load === null ? null : { load: row.best_load, reps: row.best_reps, estimate: row.best_estimate },
    fieldCount: row.field_count,
  }));
}

function bounded(value: unknown, what: string, max: number, required = true): string {
  if (typeof value !== "string") throw new WorkoutInputError(`${what} is missing.`);
  const trimmed = rejectNul(value, what).trim();
  if (required && !trimmed) throw new WorkoutInputError(`Give ${what.toLowerCase()} a value.`);
  if (trimmed.length > max) throw new WorkoutInputError(`${what} can be at most ${max} characters.`);
  return trimmed;
}

function numberIn(value: unknown, what: string, min: number, max: number, integer: boolean): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new WorkoutInputError(`${what} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
  }
  return value;
}

export async function saveExercise(input: {
  id?: string; name: string; tracking: Tracking; equipment: Equipment; barKg?: number | null; restSeconds?: number | null;
  primaryMuscle: string; secondaryMuscles?: string[]; notes?: string;
}): Promise<ExerciseInfo> {
  const name = bounded(input.name, "The name", 100);
  const primary = bounded(input.primaryMuscle, "The primary muscle", 50);
  if (!TRACKINGS.includes(input.tracking)) throw new WorkoutInputError("Choose what the exercise records.");
  if (!EQUIPMENT.includes(input.equipment)) throw new WorkoutInputError("Choose the equipment.");
  const rawSecondary = input.secondaryMuscles ?? [];
  if (!Array.isArray(rawSecondary)) throw new WorkoutInputError("Secondary muscles are not readable.");
  const secondary: string[] = [];
  for (const raw of rawSecondary) {
    const muscle = bounded(raw, "A secondary muscle", 50, false);
    if (muscle && !secondary.some((other) => other.toLowerCase() === muscle.toLowerCase())) secondary.push(muscle);
  }
  if (secondary.length > 8) throw new WorkoutInputError("An exercise can have at most 8 secondary muscles.");
  const barKg = input.equipment === "barbell" ? numberIn(input.barKg, "The bar weight", 0, 100, false) : null;
  const restSeconds = numberIn(input.restSeconds, "Rest", 0, limits.restSeconds, true);
  const notes = bounded(input.notes ?? "", "Notes", 500, false);
  if (input.id !== undefined && !isId(input.id)) throw new WorkoutInputError("That exercise no longer exists.");

  const values = [name, input.tracking, input.equipment, barKg, restSeconds, primary, secondary, notes];
  const { rows: [row] } = input.id
    ? await query<{ id: string }>(
      `UPDATE exercises SET name = $2, tracking = $3, equipment = $4, bar_kg = $5, rest_seconds = $6,
          primary_muscle = $7, secondary_muscles = $8, notes = $9 WHERE id = $1 RETURNING id`,
      [input.id, ...values],
    )
    : await query<{ id: string }>(
      `INSERT INTO exercises (name, tracking, equipment, bar_kg, rest_seconds, primary_muscle, secondary_muscles, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      values,
    );
  if (!row) throw new WorkoutInputError("That exercise no longer exists.");
  const { rows: [saved] } = await query<ExerciseRow>(`SELECT ${exerciseColumns} FROM exercises e WHERE e.id = $1`, [row.id]);
  return exerciseFrom(saved);
}

export async function setExerciseArchived(id: string, archived: boolean): Promise<void> {
  await query("UPDATE exercises SET archived_at = CASE WHEN $2::boolean THEN coalesce(archived_at, now()) END WHERE id = $1",
    [isId(id) ? id : null, archived]);
}

export async function deleteExercise(id: string): Promise<"deleted" | "in_use"> {
  if (!isId(id)) return "deleted";
  try {
    const { rowCount } = await query(
      `DELETE FROM exercises WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM workout_exercises WHERE exercise_id = $1)`, [id],
    );
    if (rowCount) return "deleted";
    const { rows: [left] } = await query("SELECT 1 FROM exercises WHERE id = $1", [id]);
    return left ? "in_use" : "deleted";
  } catch (error) {
    if ((error as { code?: string }).code === "23503") return "in_use";
    throw error;
  }
}

export async function saveField(
  input: { id?: string; label: string; unit?: string; kind: FieldKind; exerciseId?: string | null },
): Promise<FieldInfo> {
  const label = bounded(input.label, "The label", 60);
  const unit = bounded(input.unit ?? "", "The unit", 20, false);
  if (!["decimal", "integer", "text"].includes(input.kind)) throw new WorkoutInputError("Choose the kind of value.");
  const exerciseId = input.exerciseId ?? null;
  if (exerciseId !== null && !isId(exerciseId)) throw new WorkoutInputError("That exercise no longer exists.");
  if (input.id !== undefined && !isId(input.id)) throw new WorkoutInputError("That field no longer exists.");
  try {
    const { rows: [row] } = input.id
      ? await query<FieldRow>(
        `UPDATE field_definitions SET label = $2, unit = $3, kind = $4, exercise_id = $5 WHERE id = $1
          RETURNING id, label, unit, kind, exercise_id`, [input.id, label, unit, input.kind, exerciseId],
      )
      : await query<FieldRow>(
        `INSERT INTO field_definitions (label, unit, kind, exercise_id) VALUES ($1, $2, $3, $4)
          RETURNING id, label, unit, kind, exercise_id`, [label, unit, input.kind, exerciseId],
      );
    if (!row) throw new WorkoutInputError("That field no longer exists.");
    return fieldFrom(row);
  } catch (error) {
    if ((error as { code?: string }).code === "23503") throw new WorkoutInputError("That exercise no longer exists.");
    throw error;
  }
}

export async function deleteField(id: string): Promise<void> {
  await query("DELETE FROM field_definitions WHERE id = $1", [isId(id) ? id : null]);
}
