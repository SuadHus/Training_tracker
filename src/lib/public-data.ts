import { query } from "./db";
import {
  collapseSets, isId, isoWeek, summarizeSets, topSet, weekStart,
  type CustomValues, type Equipment, type ExerciseInfo, type FieldInfo, type Measures, type SetRun, type Tracking,
  type WorkSummary,
} from "./workout-doc";
import { listFields } from "./workout-store";
import { healthTimeZone, withingsMorningEndHour, withingsMorningStartHour } from "./health-normalize";

export const withingsMorningWeight = `o.provider = 'withings' AND o.metric = 'body_weight_kg'
  AND (o.observed_at AT TIME ZONE '${healthTimeZone}')::date = o.local_day
  AND extract(hour FROM o.observed_at AT TIME ZONE '${healthTimeZone}') >= ${withingsMorningStartHour}
  AND extract(hour FROM o.observed_at AT TIME ZONE '${healthTimeZone}') < ${withingsMorningEndHour}`;


const loggedMeasures = `s.reps, s.load_kg::float8 AS load, s.rpe::float8 AS rpe,
  s.duration_seconds::float8 AS duration, s.distance_meters::float8 AS distance`;

type MeasureRow = {
  reps: number | null; load: number | null; rpe: number | null; duration: number | null; distance: number | null;
};

const measuresOf = (row: MeasureRow): Measures => ({
  reps: row.reps, load: row.load, rpe: row.rpe, duration: row.duration, distance: row.distance,
});

export type PublicExercise = Pick<ExerciseInfo, "id" | "name" | "tracking" | "equipment" | "barKg" | "primaryMuscle" | "secondaryMuscles">;
export type PublicSet = { id: string; warmup: boolean; measures: Measures; custom: CustomValues };
export type PublicBlock = { id: string; exercise: PublicExercise; notes: string; sets: PublicSet[] };
export type PublicWorkout = {
  id: string; title: string; day: string; notes: string; minutes: number | null; blocks: PublicBlock[];
  fields: FieldInfo[]; vitals: DailyVitals; summary: WorkSummary; muscles: Array<{ name: string; sets: number }>;
  newer: { id: string; title: string; day: string } | null; older: { id: string; title: string; day: string } | null;
};

const exerciseFields = `e.id AS exercise_id, e.name, e.tracking, e.equipment, e.bar_kg::float8 AS bar_kg,
  e.primary_muscle, e.secondary_muscles`;

type ExerciseFieldsRow = {
  exercise_id: string; name: string; tracking: Tracking; equipment: Equipment; bar_kg: number | null;
  primary_muscle: string; secondary_muscles: string[];
};

const publicExercise = (row: ExerciseFieldsRow): PublicExercise => ({
  id: row.exercise_id, name: row.name, tracking: row.tracking, equipment: row.equipment, barKg: row.bar_kg,
  primaryMuscle: row.primary_muscle, secondaryMuscles: row.secondary_muscles,
});

/** Whole minutes between the first and last logged set; anything outside 5 to 360 is a forgotten timer, not a session. */
function sessionMinutes(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const minutes = (end.valueOf() - start.valueOf()) / 60_000;
  return minutes >= 5 && minutes <= 360 ? Math.round(minutes) : null;
}

const sessionOrder = "coalesce(started_at, completed_at, created_at)";

type Neighbour = { id: string; title: string; day: string };

export async function publicWorkout(id: string): Promise<PublicWorkout | null> {
  if (!isId(id)) return null;
  const { rows: [workout] } = await query<{
    id: string; day: string; title: string; notes: string; started_at: Date | null; first_logged: Date | null;
    last_logged: Date | null;
  }>(
    `SELECT w.id, w.local_day::text AS day, w.title, w.notes, w.started_at,
        (SELECT min(logged_at) FROM workout_sets WHERE workout_id = w.id) AS first_logged,
        (SELECT max(logged_at) FROM workout_sets WHERE workout_id = w.id) AS last_logged
      FROM workouts w WHERE w.id = $1 AND w.status = 'completed'`,
    [id],
  );
  if (!workout) return null;

  const [{ rows }, fields, vitals, { rows: [older] }, { rows: [newer] }] = await Promise.all([
    query<ExerciseFieldsRow & MeasureRow & {
      block_id: string; block_notes: string; set_id: string; warmup: boolean; custom_values: CustomValues;
    }>(
      `SELECT b.id AS block_id, b.notes AS block_notes, ${exerciseFields}, s.id AS set_id, s.warmup, s.custom_values,
          ${loggedMeasures}
        FROM workout_exercises b JOIN exercises e ON e.id = b.exercise_id
        JOIN workout_sets s ON s.workout_exercise_id = b.id AND s.logged_at IS NOT NULL
        WHERE b.workout_id = $1 ORDER BY b.position, b.id, s.position, s.id`, [id],
    ),
    listFields(),
    dailyVitals(workout.day),
    query<Neighbour>(
      `SELECT id, title, local_day::text AS day FROM workouts
        WHERE status = 'completed' AND (local_day, ${sessionOrder}, id) < (SELECT local_day, ${sessionOrder}, id FROM workouts WHERE id = $1)
        ORDER BY local_day DESC, ${sessionOrder} DESC, id DESC LIMIT 1`, [id],
    ),
    query<Neighbour>(
      `SELECT id, title, local_day::text AS day FROM workouts
        WHERE status = 'completed' AND (local_day, ${sessionOrder}, id) > (SELECT local_day, ${sessionOrder}, id FROM workouts WHERE id = $1)
        ORDER BY local_day, ${sessionOrder}, id LIMIT 1`, [id],
    ),
  ]);

  const blocks: PublicBlock[] = [];
  for (const row of rows) {
    let block = blocks.at(-1);
    if (block?.id !== row.block_id) {
      block = { id: row.block_id, exercise: publicExercise(row), notes: row.block_notes, sets: [] };
      blocks.push(block);
    }
    block.sets.push({ id: row.set_id, warmup: row.warmup, measures: measuresOf(row), custom: row.custom_values });
  }

  const working = rows.filter((row) => !row.warmup);
  const muscles = new Map<string, number>();
  for (const row of working) muscles.set(row.primary_muscle, (muscles.get(row.primary_muscle) ?? 0) + 1);

  return {
    id: workout.id, title: workout.title, day: workout.day, notes: workout.notes,
    minutes: sessionMinutes(workout.started_at ?? workout.first_logged, workout.last_logged),
    blocks, fields, vitals,
    summary: summarizeSets(rows.map((row) => ({ warmup: row.warmup, actual: measuresOf(row), loggedAt: "logged" }))),
    muscles: [...muscles].map(([name, sets]) => ({ name, sets })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)),
    newer: newer ?? null,
    older: older ?? null,
  };
}

export type SessionBlock = { exercise: PublicExercise; runs: SetRun[]; top: Measures | null };
export type SessionSummary = {
  id: string; title: string; day: string; minutes: number | null; workSets: number; volume: number; blocks: SessionBlock[];
};
export type WeekSummary = {
  year: number; week: number; start: string; sessions: SessionSummary[]; workSets: number; volume: number;
};

export async function publicWeeks(options: { limit?: number } = {}): Promise<WeekSummary[]> {
  const { rows: workouts } = await query<{ id: string; title: string; day: string; started_at: Date | null }>(
    `WITH weeks AS (
        SELECT DISTINCT date_trunc('week', local_day)::date AS start FROM workouts
        WHERE status = 'completed' ORDER BY start DESC LIMIT $1
      )
      SELECT w.id, w.title, w.local_day::text AS day, w.started_at
        FROM workouts w JOIN weeks ON w.local_day >= weeks.start AND w.local_day < weeks.start + 7
        WHERE w.status = 'completed'
        ORDER BY w.local_day, coalesce(w.started_at, w.completed_at, w.created_at), w.id`,
    [options.limit ?? null],
  );
  if (!workouts.length) return [];
  const { rows: sets } = await query<ExerciseFieldsRow & MeasureRow & {
    workout_id: string; block_id: string; warmup: boolean; logged_at: Date;
  }>(
    `SELECT s.workout_id, s.workout_exercise_id AS block_id, ${exerciseFields}, s.warmup, s.logged_at, ${loggedMeasures}
      FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
      WHERE s.workout_id = ANY($1::uuid[]) AND s.logged_at IS NOT NULL ORDER BY s.workout_id, s.position, s.id`,
    [workouts.map((workout) => workout.id)],
  );

  const byWorkout = Map.groupBy(sets, (set) => set.workout_id);
  const weeks = new Map<string, WeekSummary>();
  for (const workout of workouts) {
    const own = byWorkout.get(workout.id) ?? [];
    const stamps = own.map((set) => set.logged_at);
    const first = stamps.length ? new Date(Math.min(...stamps.map(Number))) : null;
    const last = stamps.length ? new Date(Math.max(...stamps.map(Number))) : null;
    const asDocs = own.map((set) => ({ warmup: set.warmup, actual: measuresOf(set), loggedAt: set.logged_at.toISOString() }));
    const total = summarizeSets(asDocs);

    const blocks: SessionBlock[] = [];
    for (const [, group] of Map.groupBy(own.filter((set) => !set.warmup), (set) => set.block_id)) {
      const work = group.map((set) => ({ warmup: false, actual: measuresOf(set), loggedAt: "logged" }));
      const top = topSet(work);
      blocks.push({
        exercise: publicExercise(group[0]),
        runs: collapseSets(work.map((set) => ({ measures: set.actual, warmup: false }))),
        top: top ? top.actual : null,
      });
    }

    const start = weekStart(workout.day);
    let week = weeks.get(start);
    if (!week) {
      week = { ...isoWeek(start), start, sessions: [], workSets: 0, volume: 0 };
      weeks.set(start, week);
    }
    week.sessions.push({
      id: workout.id, title: workout.title, day: workout.day, minutes: sessionMinutes(workout.started_at ?? first, last),
      workSets: total.workSets, volume: total.volume, blocks,
    });
    week.workSets += total.workSets;
    week.volume += total.volume;
  }
  return [...weeks.values()].sort((a, b) => b.start.localeCompare(a.start));
}

export type BestLift = {
  exerciseId: string; name: string; equipment: Equipment; barKg: number | null; load: number; reps: number;
  estimate: number; day: string; workoutId: string;
};

export async function publicBestLifts(limit = 6): Promise<BestLift[]> {
  const { rows } = await query<{
    exercise_id: string; name: string; equipment: Equipment; bar_kg: number | null; load: number; reps: number;
    estimate: number; day: string; workout_id: string;
  }>(
    `SELECT * FROM (
        SELECT DISTINCT ON (e.id) e.id AS exercise_id, e.name, e.equipment, e.bar_kg::float8 AS bar_kg,
            s.load_kg::float8 AS load, s.reps,
            (s.load_kg * CASE WHEN s.reps = 1 THEN 1 ELSE 1 + s.reps / 30.0 END)::float8 AS estimate,
            w.local_day::text AS day, w.id AS workout_id
          FROM workout_sets s JOIN workouts w ON w.id = s.workout_id AND w.status = 'completed'
          JOIN exercises e ON e.id = s.exercise_id
          WHERE s.logged_at IS NOT NULL AND NOT s.warmup AND s.load_kg > 0 AND s.reps BETWEEN 1 AND 10
            AND e.tracking = 'weight_reps' AND e.equipment = 'barbell'
          ORDER BY e.id, estimate DESC, w.local_day DESC, s.id
      ) best ORDER BY estimate DESC, name, exercise_id LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    exerciseId: row.exercise_id, name: row.name, equipment: row.equipment, barKg: row.bar_kg, load: row.load,
    reps: row.reps, estimate: row.estimate, day: row.day, workoutId: row.workout_id,
  }));
}

export async function publicTotals(): Promise<{ sessions: number; firstDay: string | null; lastDay: string | null }> {
  const { rows: [row] } = await query<{ sessions: number; first_day: string | null; last_day: string | null }>(
    `SELECT count(*)::int AS sessions, min(local_day)::text AS first_day, max(local_day)::text AS last_day
      FROM workouts WHERE status = 'completed'`,
  );
  return { sessions: row.sessions, firstDay: row.first_day, lastDay: row.last_day };
}

export type DailyVitals = {
  resting_heart_rate: number | null;
  sleep_minutes: number | null;
  sleep_score: number | null;
  body_weight_kg: number | null;
};

export async function dailyVitals(day: string) {
  const { rows: [vitals] } = await query<DailyVitals>(
    `SELECT
      coalesce(p.resting_heart_rate, max(o.value) FILTER (WHERE o.metric = 'resting_heart_rate'))::float8 AS resting_heart_rate,
      coalesce(p.sleep_minutes, max(o.value) FILTER (WHERE o.metric = 'sleep_minutes'))::float8 AS sleep_minutes,
      coalesce(p.sleep_score, max(o.value) FILTER (WHERE o.metric = 'sleep_score'))::float8 AS sleep_score,
      (array_agg(o.value ORDER BY o.observed_at, o.external_id) FILTER (WHERE o.metric = 'body_weight_kg'))[1]::float8 AS body_weight_kg
    FROM (SELECT $1::date AS day) d LEFT JOIN published_daily_vitals p ON p.local_day = d.day
    LEFT JOIN health_observations o ON o.local_day = d.day AND (
      ($2::boolean AND o.provider = 'google-health' AND o.metric IN ('resting_heart_rate', 'sleep_minutes', 'sleep_score'))
      OR ($3::boolean AND ${withingsMorningWeight})
    )
    GROUP BY p.local_day`,
    [day, process.env.PUBLISH_GOOGLE_HEALTH === "true", process.env.PUBLISH_WITHINGS === "true"],
  );
  return vitals;
}

export async function publicJournal(limit?: number) {
  const { rows } = await query<{ id: string; title: string; day: string; excerpt: string; photo: string | null }>(
    `SELECT j.id, j.title, (j.published_at AT TIME ZONE 'Europe/Stockholm')::date::text AS day,
        left(j.body, 200) AS excerpt,
        (SELECT p.id FROM journal_photos p WHERE p.post_id = j.id ORDER BY p.created_at, p.id LIMIT 1) AS photo
      FROM journal_posts j WHERE j.published_at <= now()
      ORDER BY j.published_at DESC, j.id LIMIT $1`, [limit ?? null],
  );
  return rows;
}

export async function publicJournalPost(id: string) {
  const { rows: [post] } = await query<{ title: string; body: string; day: string }>(
    `SELECT title, body, (published_at AT TIME ZONE 'Europe/Stockholm')::date::text AS day
      FROM journal_posts WHERE id = $1 AND published_at <= now()`, [id],
  );
  if (!post) return null;
  const { rows: photos } = await query<{ id: string; alt: string }>(
    `SELECT p.id, p.alt FROM journal_photos p JOIN journal_posts j ON j.id = p.post_id
      WHERE p.post_id = $1 AND j.published_at <= now() ORDER BY p.created_at, p.id`, [id],
  );
  return { ...post, photos };
}
