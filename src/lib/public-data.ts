import { query } from "./db";

export type WorkoutSummary = {
  id: string;
  title: string;
  day: string;
  work_sets: number;
  tonnage: number;
};

const recorded = `(s.logged_at IS NOT NULL OR s.reps IS NOT NULL OR s.load_kg IS NOT NULL
  OR s.rpe IS NOT NULL OR s.distance_meters IS NOT NULL OR s.duration_seconds IS NOT NULL
  OR s.custom_values <> '{}'::jsonb)`;

export async function publicWorkouts(limit?: number) {
  const { rows } = await query<WorkoutSummary>(
    `SELECT w.id, w.title, w.local_day::text AS day,
        count(s.id) FILTER (WHERE NOT s.warmup)::int AS work_sets,
        coalesce(sum(s.reps * s.load_kg) FILTER (WHERE NOT s.warmup), 0)::float8 AS tonnage
      FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id AND ${recorded}
      WHERE w.status = 'completed' GROUP BY w.id
      ORDER BY w.local_day DESC, w.id LIMIT $1`,
    [limit ?? null],
  );
  return rows;
}

type PublicSet = {
  id: string;
  exercise_id: string;
  exercise: string;
  exercise_type: string;
  primary_muscle: string;
  secondary_muscles: string[];
  reps: number | null;
  load_kg: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  warmup: boolean;
  custom_values: Record<string, unknown>;
};

export async function publicWorkout(id: string) {
  const { rows: [workout] } = await query<{ id: string; day: string; title: string; notes: string }>(
    "SELECT id, local_day::text AS day, title, notes FROM workouts WHERE id = $1 AND status = 'completed'",
    [id],
  );
  if (!workout) return null;
  const [{ rows: sets }, { rows: fields }, vitals] = await Promise.all([
    query<PublicSet>(
      `SELECT s.id, e.id AS exercise_id, e.name AS exercise, e.type AS exercise_type,
          e.primary_muscle, e.secondary_muscles, s.reps, s.load_kg::float8, s.rpe::float8,
          s.duration_seconds::float8, s.distance_meters::float8, s.warmup, s.custom_values
        FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
        JOIN workouts w ON w.id = s.workout_id AND w.status = 'completed'
        WHERE s.workout_id = $1 AND ${recorded}
        ORDER BY s.position, s.id`, [id],
    ),
    query<{ id: string; label: string; unit: string; exercise_id: string | null }>(
      "SELECT id, label, unit, exercise_id FROM field_definitions ORDER BY label, id",
    ),
    dailyVitals(workout.day),
  ]);
  return { ...workout, sets, fields, vitals };
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
      coalesce(p.body_weight_kg, max(o.value) FILTER (WHERE o.metric = 'body_weight_kg'))::float8 AS body_weight_kg
    FROM (SELECT $1::date AS day) d LEFT JOIN published_daily_vitals p ON p.local_day = d.day
    LEFT JOIN health_observations o ON o.local_day = d.day AND (
      ($2::boolean AND o.provider = 'google-health' AND o.metric IN ('resting_heart_rate', 'sleep_minutes', 'sleep_score'))
      OR ($3::boolean AND o.provider = 'withings' AND o.metric = 'body_weight_kg')
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

export async function publicProgress() {
  const [{ rows: weeks }, { rows: lifts }] = await Promise.all([
    query<{ day: string; tonnage: number }>(
      `WITH weeks AS (
        SELECT generate_series(date_trunc('week', now() AT TIME ZONE 'Europe/Stockholm') - interval '5 weeks',
          date_trunc('week', now() AT TIME ZONE 'Europe/Stockholm'), interval '1 week')::date AS day
      )
      SELECT week.day::text, coalesce(sum(s.reps * s.load_kg), 0)::float8 AS tonnage
      FROM weeks week LEFT JOIN workouts w ON w.status = 'completed' AND w.local_day >= week.day AND w.local_day < week.day + 7
      LEFT JOIN workout_sets s ON s.workout_id = w.id AND NOT s.warmup
      GROUP BY week.day ORDER BY week.day`,
    ),
    query<{ id: string; name: string; weight: number; reps: number; estimate: number }>(
      `SELECT id, name, weight, reps, estimate FROM (
        SELECT DISTINCT ON (e.id) e.id, e.name, s.load_kg::float8 AS weight, s.reps,
          (s.load_kg * CASE WHEN s.reps = 1 THEN 1 ELSE 1 + s.reps / 30.0 END)::float8 AS estimate,
          w.local_day
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
        JOIN exercises e ON e.id = s.exercise_id
        WHERE w.status = 'completed' AND NOT s.warmup AND s.load_kg > 0 AND s.reps BETWEEN 1 AND 10
        ORDER BY e.id, estimate DESC, w.local_day DESC, s.id
      ) best ORDER BY local_day DESC, name LIMIT 8`,
    ),
  ]);
  return { weeks, lifts };
}
