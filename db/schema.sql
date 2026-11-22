BEGIN;

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

COMMIT;
