-- The database as it was before exercise blocks existed: the original schema
-- plus eight weeks of training. tests/migration.test.ts loads this, applies
-- db/schema.sql on top, and checks nothing was lost. Also a handy dev seed.

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

BEGIN;

INSERT INTO exercises (id, name, type, primary_muscle, secondary_muscles) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Low-bar squat', 'Strength', 'Quads', '{Glutes,Back}'),
  ('00000000-0000-4000-8000-000000000002', 'Bench press', 'Strength', 'Chest', '{Triceps,Shoulders}'),
  ('00000000-0000-4000-8000-000000000003', 'Deadlift', 'Strength', 'Back', '{Glutes,Hamstrings}'),
  ('00000000-0000-4000-8000-000000000004', 'Overhead press', 'Strength', 'Shoulders', '{Triceps}'),
  ('00000000-0000-4000-8000-000000000005', 'Barbell row', 'Strength', 'Back', '{Biceps}'),
  ('00000000-0000-4000-8000-000000000006', 'Chin-up', 'Bodyweight', 'Back', '{Biceps}'),
  ('00000000-0000-4000-8000-000000000007', 'Leg press', 'Strength', 'Quads', '{Glutes}'),
  ('00000000-0000-4000-8000-000000000008', 'Romanian deadlift', 'Strength', 'Hamstrings', '{Glutes,Back}'),
  ('00000000-0000-4000-8000-000000000009', 'Plank', 'Mobility', 'Core', '{}'),
  ('00000000-0000-4000-8000-00000000000a', 'Easy run', 'Cardio', 'Legs', '{}'),
  ('00000000-0000-4000-8000-00000000000b', 'Dumbbell curl', 'Strength', 'Biceps', '{}'),
  ('00000000-0000-4000-8000-00000000000c', 'Front squat', 'Strength', 'Quads', '{Core}'),
  ('00000000-0000-4000-8000-00000000000d', 'Back extension', 'Bodyweight', 'Back', '{Glutes}'),
  ('00000000-0000-4000-8000-00000000000e', 'Never used', 'Strength', 'Forearms', '{}');

INSERT INTO field_definitions (id, label, unit, kind, exercise_id) VALUES
  ('00000000-0000-4000-9000-000000000001', 'Bar speed', 'm/s', 'decimal', NULL),
  ('00000000-0000-4000-9000-000000000002', 'Cue', '', 'text', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-9000-000000000003', 'Incline', '%', 'integer', '00000000-0000-4000-8000-00000000000a');

-- Templates.
INSERT INTO workouts (id, title, status, notes) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Lower A', 'template', 'Squat first. Keep two reps in the tank.'),
  ('00000000-0000-4000-a000-000000000002', 'Upper A', 'template', ''),
  ('00000000-0000-4000-a000-000000000003', 'Lower B', 'template', ''),
  ('00000000-0000-4000-a000-000000000004', 'Empty template', 'template', '');

INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup) VALUES
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 1, 5, 60, true),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 2, 3, 100, true),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 3, 5, 140, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 4, 5, 140, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000001', 5, 5, 140, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000008', 6, 8, 110, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000008', 7, 8, 110, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000008', 8, 8, 110, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000007', 9, 12, 200, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000007', 10, 12, 200, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000009', 11, NULL, NULL, false),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000009', 12, NULL, NULL, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000002', 1, 5, 60, true),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000002', 2, 5, 95, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000002', 3, 5, 95, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000002', 4, 5, 95, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000005', 5, 8, 80, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000005', 6, 8, 80, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000005', 7, 8, 80, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000004', 8, 6, 55, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000004', 9, 6, 55, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000006', 10, 6, NULL, false),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000006', 11, 6, NULL, false),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8000-000000000003', 1, 3, 180, false),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8000-000000000003', 2, 5, 165, false),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8000-00000000000c', 3, 5, 100, false),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8000-00000000000c', 4, 5, 100, false);

-- Eight weeks of completed sessions, ending in the current week.
CREATE TEMP TABLE seed_week ON COMMIT DROP AS
  SELECT n AS week, (date_trunc('week', current_date)::date - (7 * (7 - n))) AS monday, 2.5 * n AS gain
  FROM generate_series(0, 7) AS n;

CREATE TEMP TABLE seed_session ON COMMIT DROP AS
  SELECT gen_random_uuid() AS id, w.week, w.gain, plan.title, plan.template_id, (w.monday + plan.offset_days) AS day
  FROM seed_week w
  CROSS JOIN (VALUES
    ('Lower A', '00000000-0000-4000-a000-000000000001'::uuid, 0),
    ('Upper A', '00000000-0000-4000-a000-000000000002'::uuid, 2),
    ('Lower B', '00000000-0000-4000-a000-000000000003'::uuid, 4)
  ) AS plan(title, template_id, offset_days)
  WHERE (w.monday + plan.offset_days) < current_date;

INSERT INTO workouts (id, title, local_day, status, template_id, notes)
  SELECT id, title, day, 'completed', template_id,
    CASE WHEN week = 7 AND title = 'Lower A' THEN 'Felt heavy off the floor; kept RPE honest.' ELSE '' END
  FROM seed_session;

CREATE TEMP TABLE seed_plan (title text, exercise_id uuid, place int, reps int, load numeric, rpe numeric, warmup boolean, grows boolean) ON COMMIT DROP;
INSERT INTO seed_plan VALUES
  ('Lower A', '00000000-0000-4000-8000-000000000001', 1, 5, 60, NULL, true, false),
  ('Lower A', '00000000-0000-4000-8000-000000000001', 2, 3, 100, NULL, true, false),
  ('Lower A', '00000000-0000-4000-8000-000000000001', 3, 5, 122.5, 7, false, true),
  ('Lower A', '00000000-0000-4000-8000-000000000001', 4, 5, 122.5, 7.5, false, true),
  ('Lower A', '00000000-0000-4000-8000-000000000001', 5, 5, 122.5, 8, false, true),
  ('Lower A', '00000000-0000-4000-8000-000000000008', 6, 8, 92.5, NULL, false, true),
  ('Lower A', '00000000-0000-4000-8000-000000000008', 7, 8, 92.5, NULL, false, true),
  ('Lower A', '00000000-0000-4000-8000-000000000008', 8, 8, 92.5, NULL, false, true),
  ('Lower A', '00000000-0000-4000-8000-000000000007', 9, 12, 200, NULL, false, false),
  ('Lower A', '00000000-0000-4000-8000-000000000007', 10, 12, 200, NULL, false, false),
  ('Lower A', '00000000-0000-4000-8000-000000000007', 11, 10, 200, NULL, false, false),
  ('Upper A', '00000000-0000-4000-8000-000000000002', 1, 5, 60, NULL, true, false),
  ('Upper A', '00000000-0000-4000-8000-000000000002', 2, 3, 80, NULL, true, false),
  ('Upper A', '00000000-0000-4000-8000-000000000002', 3, 5, 77.5, 7.5, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000002', 4, 5, 77.5, 8, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000002', 5, 5, 77.5, 8.5, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000005', 6, 8, 62.5, NULL, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000005', 7, 8, 62.5, NULL, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000005', 8, 8, 62.5, NULL, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000004', 9, 6, 37.5, NULL, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000004', 10, 6, 37.5, NULL, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000004', 11, 5, 37.5, NULL, false, true),
  ('Upper A', '00000000-0000-4000-8000-000000000006', 12, 6, 10, NULL, false, false),
  ('Upper A', '00000000-0000-4000-8000-000000000006', 13, 6, 10, NULL, false, false),
  ('Upper A', '00000000-0000-4000-8000-000000000006', 14, 5, NULL, NULL, false, false),
  ('Lower B', '00000000-0000-4000-8000-000000000003', 1, 3, 100, NULL, true, false),
  ('Lower B', '00000000-0000-4000-8000-000000000003', 2, 1, 140, NULL, true, false),
  ('Lower B', '00000000-0000-4000-8000-000000000003', 3, 3, 162.5, 8, false, true),
  ('Lower B', '00000000-0000-4000-8000-000000000003', 4, 5, 147.5, NULL, false, true),
  ('Lower B', '00000000-0000-4000-8000-000000000003', 5, 5, 147.5, NULL, false, true),
  ('Lower B', '00000000-0000-4000-8000-00000000000c', 6, 5, 82.5, NULL, false, true),
  ('Lower B', '00000000-0000-4000-8000-00000000000c', 7, 5, 82.5, NULL, false, true),
  ('Lower B', '00000000-0000-4000-8000-00000000000c', 8, 5, 82.5, NULL, false, true),
  ('Lower B', '00000000-0000-4000-8000-00000000000d', 9, 12, NULL, NULL, false, false),
  ('Lower B', '00000000-0000-4000-8000-00000000000d', 10, 12, NULL, NULL, false, false),
  -- The squat comes back at the end of Lower B: the same exercise twice in one session.
  ('Lower B', '00000000-0000-4000-8000-000000000001', 11, 8, 100, NULL, false, false);

INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, reps, load_kg, rpe, warmup, custom_values, logged_at)
  SELECT s.id, p.exercise_id, p.place, p.reps, p.load + CASE WHEN p.grows THEN s.gain ELSE 0 END,
    p.reps, p.load + CASE WHEN p.grows THEN s.gain ELSE 0 END, p.rpe, p.warmup,
    CASE WHEN p.exercise_id = '00000000-0000-4000-8000-000000000001' AND p.place = 3
      THEN jsonb_build_object('00000000-0000-4000-9000-000000000001', 0.62, '00000000-0000-4000-9000-000000000002', 'Knees out')
      ELSE '{}'::jsonb END,
    ((s.day + time '17:30') AT TIME ZONE 'Europe/Stockholm') + (p.place * interval '4 minutes 30 seconds')
  FROM seed_session s JOIN seed_plan p ON p.title = s.title;

-- Timed and distance work, a values-only set with no timestamp, and a planned
-- set left unlogged on a completed session.
INSERT INTO workout_sets (workout_id, exercise_id, position, duration_seconds, logged_at)
  SELECT id, '00000000-0000-4000-8000-000000000009', 20 + n, 60 - 15 * (n - 1),
    ((day + time '18:30') AT TIME ZONE 'Europe/Stockholm') + (n * interval '2 minutes')
  FROM seed_session CROSS JOIN generate_series(1, 2) AS n WHERE title = 'Lower A';

INSERT INTO workouts (id, title, local_day, status, notes) VALUES
  ('00000000-0000-4000-a000-000000000010', 'Easy run', current_date - 3, 'completed', 'Zone 2 around the lake.'),
  ('00000000-0000-4000-a000-000000000011', 'Odds and ends', current_date - 9, 'completed', '');
INSERT INTO workout_sets (workout_id, exercise_id, position, duration_seconds, distance_meters, custom_values, logged_at) VALUES
  ('00000000-0000-4000-a000-000000000010', '00000000-0000-4000-8000-00000000000a', 1, 1890, 5200,
    '{"00000000-0000-4000-9000-000000000003": 1}', now() - interval '3 days');
INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, reps, load_kg, logged_at) VALUES
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-8000-00000000000b', 1, 12, 14, 12, 14, NULL),
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-8000-00000000000b', 2, 12, 14, 11, 14, now() - interval '9 days'),
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-8000-00000000000b', 3, 12, 14, NULL, NULL, NULL),
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-8000-000000000006', 4, NULL, NULL, 8, NULL, now() - interval '9 days'),
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-8000-00000000000b', 5, NULL, NULL, 10, 12, now() - interval '9 days');
INSERT INTO workout_sets (workout_id, exercise_id, position, custom_values, logged_at) VALUES
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-8000-000000000001', 6,
    '{"00000000-0000-4000-9000-000000000002": "Technique only, empty bar"}', now() - interval '9 days');

-- Today's session, half logged; a future one; an old one never started; one with no sets.
INSERT INTO workouts (id, title, local_day, status, template_id) VALUES
  ('00000000-0000-4000-a000-000000000020', 'Upper A', current_date, 'planned', '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-a000-000000000021', 'Lower B', current_date + 2, 'planned', '00000000-0000-4000-a000-000000000003'),
  ('00000000-0000-4000-a000-000000000022', 'Skipped session', current_date - 12, 'planned', NULL),
  ('00000000-0000-4000-a000-000000000023', 'Blank plan', current_date + 5, 'planned', NULL);
INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup)
  SELECT w.id, t.exercise_id, t.position, t.target_reps, t.target_load_kg, t.warmup
  FROM workouts w JOIN workout_sets t ON t.workout_id = w.template_id
  WHERE w.id IN ('00000000-0000-4000-a000-000000000020', '00000000-0000-4000-a000-000000000021');
UPDATE workout_sets SET reps = target_reps, load_kg = target_load_kg, rpe = CASE WHEN warmup THEN NULL ELSE 7.5 END,
    logged_at = now() - interval '20 minutes' + position * interval '4 minutes'
  WHERE workout_id = '00000000-0000-4000-a000-000000000020' AND position <= 2;
INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg) VALUES
  ('00000000-0000-4000-a000-000000000022', '00000000-0000-4000-8000-000000000004', 1, 5, 50);

-- Day vitals: some entered by hand, some synced.
INSERT INTO published_daily_vitals (local_day, resting_heart_rate, sleep_minutes, sleep_score)
  SELECT day, 50 + (week % 3), 440 + week * 3, 80 + (week % 6) FROM seed_session WHERE title = 'Lower A';
INSERT INTO health_observations (provider, external_id, metric, local_day, observed_at, value)
  SELECT 'withings', day::text, 'body_weight_kg', day, (day + time '06:42') AT TIME ZONE 'Europe/Stockholm', 84.4 - week * 0.1
  FROM seed_session
  UNION ALL
  SELECT 'google-health', day::text, 'resting_heart_rate', day, NULL, 52 FROM seed_session
  UNION ALL
  SELECT 'google-health', day::text, 'sleep_minutes', day, (day + time '06:10') AT TIME ZONE 'Europe/Stockholm', 431 FROM seed_session;

INSERT INTO journal_posts (id, title, body, published_at) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Switching to low-bar',
    E'Three weeks in. The bar sits lower, the hips do more, and 140 moves like 130 used to.\n\nElbows complain, so the grip went wider. Wrist wraps help more than expected.',
    now() - interval '8 days'),
  ('00000000-0000-4000-b000-000000000002', 'Why the log is public',
    E'Writing the numbers down where anyone can read them keeps them honest.',
    now() - interval '30 days'),
  ('00000000-0000-4000-b000-000000000003', 'Unfinished thoughts on deloads', 'Draft.', NULL);

COMMIT;
