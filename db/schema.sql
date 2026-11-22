-- Runs on every release (see Procfile) and must stay safe to repeat.
-- Part 1 creates the original tables. Part 2 brings any database, new or
-- existing, to the current shape. One-time data moves are recorded in
-- schema_migrations so they never run twice.

BEGIN;

-- Part 1: original tables -------------------------------------------------

CREATE TABLE IF NOT EXISTS exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  primary_muscle text NOT NULL,
  secondary_muscles text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  unit text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('decimal', 'integer', 'text')),
  exercise_id uuid REFERENCES exercises(id)
);

CREATE TABLE IF NOT EXISTS workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  local_day date,
  status text NOT NULL CHECK (status IN ('template', 'planned', 'completed')),
  template_id uuid REFERENCES workouts(id),
  notes text NOT NULL DEFAULT '',
  CHECK ((status = 'template') = (local_day IS NULL))
);
CREATE INDEX IF NOT EXISTS workouts_status_day ON workouts(status, local_day DESC);

CREATE TABLE IF NOT EXISTS workout_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  position int NOT NULL CHECK (position >= 0),
  target_reps int CHECK (target_reps >= 0),
  target_load_kg numeric CHECK (target_load_kg >= 0),
  reps int CHECK (reps >= 0),
  load_kg numeric CHECK (load_kg >= 0),
  rpe numeric CHECK (rpe BETWEEN 1 AND 10),
  warmup boolean NOT NULL DEFAULT false,
  custom_values jsonb NOT NULL DEFAULT '{}',
  duration_seconds numeric CHECK (duration_seconds >= 0),
  distance_meters numeric CHECK (distance_meters >= 0),
  logged_at timestamptz,
  CHECK (jsonb_typeof(custom_values) = 'object')
);
CREATE INDEX IF NOT EXISTS sets_workout_position ON workout_sets(workout_id, position);

CREATE TABLE IF NOT EXISTS source_connections (
  provider text PRIMARY KEY,
  credentials text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_observations (
  provider text NOT NULL,
  external_id text NOT NULL,
  metric text NOT NULL,
  local_day date NOT NULL,
  observed_at timestamptz,
  value numeric NOT NULL CHECK (value >= 0),
  PRIMARY KEY(provider, external_id, metric)
);
CREATE INDEX IF NOT EXISTS observations_day ON health_observations(local_day, provider, metric);

CREATE TABLE IF NOT EXISTS published_daily_vitals (
  local_day date PRIMARY KEY,
  resting_heart_rate numeric CHECK (resting_heart_rate > 0),
  sleep_minutes int CHECK (sleep_minutes BETWEEN 0 AND 1440),
  sleep_score int CHECK (sleep_score BETWEEN 0 AND 100),
  body_weight_kg numeric CHECK (body_weight_kg > 0)
);

CREATE TABLE IF NOT EXISTS journal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES journal_posts(id) ON DELETE CASCADE,
  alt text NOT NULL,
  image bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Part 2: current shape ---------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Exercises say what a set of them records and what they are loaded with.
-- "type" is the original free-text label. Nothing reads it any more; it stays
-- so no owner-entered text is lost.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS tracking text,
  ADD COLUMN IF NOT EXISTS equipment text,
  ADD COLUMN IF NOT EXISTS bar_kg numeric CHECK (bar_kg >= 0 AND bar_kg <= 100),
  ADD COLUMN IF NOT EXISTS rest_seconds int CHECK (rest_seconds BETWEEN 0 AND 3600),
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE exercises ALTER COLUMN type SET DEFAULT '';

UPDATE exercises e SET tracking = CASE
    WHEN EXISTS (SELECT 1 FROM workout_sets s WHERE s.exercise_id = e.id AND s.distance_meters IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM workout_sets s WHERE s.exercise_id = e.id AND s.reps IS NOT NULL) THEN 'distance_duration'
    WHEN EXISTS (SELECT 1 FROM workout_sets s WHERE s.exercise_id = e.id AND s.duration_seconds IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM workout_sets s WHERE s.exercise_id = e.id AND s.reps IS NOT NULL) THEN 'duration'
    WHEN e.type ~* '\m(cardio|run|running|cycling|rowing|swim|swimming|endurance|conditioning)\M' THEN 'distance_duration'
    WHEN e.type ~* '\m(mobility|stretch|stretching|isometric)\M' THEN 'duration'
    WHEN e.type ~* 'body' THEN 'bodyweight_reps'
    ELSE 'weight_reps'
  END
  WHERE e.tracking IS NULL;

UPDATE exercises e SET equipment = CASE
    WHEN e.tracking IN ('distance_duration', 'duration') THEN 'other'
    WHEN e.name ~* '\m(dumbbell|dumbbells|db)\M' THEN 'dumbbell'
    WHEN e.name ~* '\m(kettlebell|kb)\M' THEN 'kettlebell'
    WHEN e.name ~* '\m(cable|pulldown|pushdown|face pull)\M' THEN 'cable'
    WHEN e.name ~* '\m(machine|leg press|leg extension|leg curl|hack squat|smith|pec deck)\M' THEN 'machine'
    WHEN e.tracking = 'bodyweight_reps'
      OR e.name ~* '\m(pull-?up|chin-?up|push-?up|dip|dips|back extension)\M' THEN 'bodyweight'
    WHEN e.name ~* '\m(barbell|squat|bench|deadlift|overhead press|military press|clean|snatch|jerk|good morning|hip thrust)\M' THEN 'barbell'
    ELSE 'other'
  END
  WHERE e.equipment IS NULL;

ALTER TABLE exercises
  ALTER COLUMN tracking SET DEFAULT 'weight_reps',
  ALTER COLUMN tracking SET NOT NULL,
  ALTER COLUMN equipment SET DEFAULT 'other',
  ALTER COLUMN equipment SET NOT NULL;

ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_tracking_check;
ALTER TABLE exercises ADD CONSTRAINT exercises_tracking_check
  CHECK (tracking IN ('weight_reps', 'bodyweight_reps', 'duration', 'distance_duration'));
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_equipment_check;
ALTER TABLE exercises ADD CONSTRAINT exercises_equipment_check
  CHECK (equipment IN ('barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'bodyweight', 'other'));

-- A custom field scoped to one exercise goes when that exercise goes.
ALTER TABLE field_definitions DROP CONSTRAINT IF EXISTS field_definitions_exercise_id_fkey;
ALTER TABLE field_definitions ADD CONSTRAINT field_definitions_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE;

-- Workouts carry timing and a revision counter. Every save names the revision
-- it started from, so a stale tab cannot overwrite a newer one.
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Deleting a template keeps the sessions that were started from it.
ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_template_id_fkey;
ALTER TABLE workouts ADD CONSTRAINT workouts_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES workouts(id) ON DELETE SET NULL;

-- A workout is an ordered list of exercise blocks, and each block owns its
-- sets. Templates, planned sessions and completed sessions share this shape.
CREATE TABLE IF NOT EXISTS workout_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  position int NOT NULL CHECK (position >= 0),
  notes text NOT NULL DEFAULT '',
  rest_seconds int CHECK (rest_seconds BETWEEN 0 AND 3600),
  UNIQUE (id, workout_id, exercise_id)
);
CREATE INDEX IF NOT EXISTS workout_exercises_order ON workout_exercises(workout_id, position);

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS workout_exercise_id uuid,
  ADD COLUMN IF NOT EXISTS target_reps_max int CHECK (target_reps_max >= 0),
  ADD COLUMN IF NOT EXISTS target_rpe numeric CHECK (target_rpe BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS target_duration_seconds numeric CHECK (target_duration_seconds >= 0),
  ADD COLUMN IF NOT EXISTS target_distance_meters numeric CHECK (target_distance_meters >= 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '2026-11-exercise-blocks') THEN
    -- Sets used to be one flat list per workout, and a run of neighbouring
    -- sets of the same exercise was shown as a block. Make each run a real block.
    CREATE TEMP TABLE legacy_runs ON COMMIT DROP AS
      WITH ordered AS (
        SELECT id, workout_id, exercise_id,
          row_number() OVER (PARTITION BY workout_id ORDER BY position, id) AS place,
          lag(exercise_id) OVER (PARTITION BY workout_id ORDER BY position, id) AS previous
        FROM workout_sets
        WHERE workout_exercise_id IS NULL
      )
      SELECT id, workout_id, exercise_id,
        sum(CASE WHEN previous IS DISTINCT FROM exercise_id THEN 1 ELSE 0 END)
          OVER (PARTITION BY workout_id ORDER BY place) AS run
      FROM ordered;

    CREATE TEMP TABLE legacy_blocks ON COMMIT DROP AS
      SELECT gen_random_uuid() AS id, workout_id, exercise_id, run
      FROM legacy_runs
      GROUP BY workout_id, exercise_id, run;

    INSERT INTO workout_exercises (id, workout_id, exercise_id, position)
      SELECT id, workout_id, exercise_id, run - 1 FROM legacy_blocks;

    UPDATE workout_sets s SET workout_exercise_id = b.id
      FROM legacy_runs r
      JOIN legacy_blocks b ON b.workout_id = r.workout_id AND b.run = r.run
      WHERE s.id = r.id;

    -- A set used to count as logged when it had a timestamp or any recorded
    -- value. From here on the timestamp alone says so, so stamp the rest once, at the
    -- session's own last stamp so session length is not distorted (noon of the day when nothing was stamped).
    UPDATE workout_sets s
      SET logged_at = coalesce(
        (SELECT max(done.logged_at) FROM workout_sets done WHERE done.workout_id = s.workout_id AND done.logged_at IS NOT NULL),
        (w.local_day + time '12:00') AT TIME ZONE 'Europe/Stockholm')
      FROM workouts w
      WHERE w.id = s.workout_id AND w.status <> 'template' AND s.logged_at IS NULL
        AND (s.reps IS NOT NULL OR s.load_kg IS NOT NULL OR s.rpe IS NOT NULL
          OR s.duration_seconds IS NOT NULL OR s.distance_meters IS NOT NULL
          OR s.custom_values <> '{}'::jsonb);

    UPDATE workouts w
      SET started_at = coalesce(w.started_at, span.first_logged),
          completed_at = coalesce(w.completed_at, CASE WHEN w.status = 'completed' THEN span.last_logged END)
      FROM (
        SELECT workout_id, min(logged_at) AS first_logged, max(logged_at) AS last_logged
        FROM workout_sets WHERE logged_at IS NOT NULL GROUP BY workout_id
      ) span
      WHERE span.workout_id = w.id AND w.status <> 'template';

    INSERT INTO schema_migrations (name) VALUES ('2026-11-exercise-blocks');
  END IF;
END
$$;

ALTER TABLE workout_sets ALTER COLUMN workout_exercise_id SET NOT NULL;

-- The block decides which workout and exercise a set belongs to. Swapping the
-- exercise of a block carries its sets along.
ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_block_fkey;
ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_block_fkey
  FOREIGN KEY (workout_exercise_id, workout_id, exercise_id)
  REFERENCES workout_exercises (id, workout_id, exercise_id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS sets_block_position ON workout_sets(workout_exercise_id, position);
CREATE INDEX IF NOT EXISTS sets_exercise_logged ON workout_sets(exercise_id, logged_at DESC) WHERE logged_at IS NOT NULL;

COMMIT;
