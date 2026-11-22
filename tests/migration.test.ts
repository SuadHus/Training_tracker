import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { databaseUrl, isolatedSchema, legacySql, schemaSql } from "./isolated-schema";

const skip = !databaseUrl;
let legacy: Awaited<ReturnType<typeof isolatedSchema>>;
let empty: Awaited<ReturnType<typeof isolatedSchema>>;

const oldRecorded = `(s.logged_at IS NOT NULL OR s.reps IS NOT NULL OR s.load_kg IS NOT NULL OR s.rpe IS NOT NULL
  OR s.distance_meters IS NOT NULL OR s.duration_seconds IS NOT NULL OR s.custom_values <> '{}'::jsonb)`;

async function figures() {
  const [row] = await legacy.rows<{ workouts: number; sets: number; visible: number; tonnage: number }>(
    `SELECT (SELECT count(*) FROM workouts)::int AS workouts,
        (SELECT count(*) FROM workout_sets)::int AS sets,
        (SELECT count(*) FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
          WHERE w.status = 'completed' AND ${oldRecorded})::int AS visible,
        (SELECT coalesce(sum(s.reps * s.load_kg), 0) FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
          WHERE w.status = 'completed' AND NOT s.warmup AND ${oldRecorded})::float8 AS tonnage`,
  );
  return row;
}

const newVisible = `SELECT count(*)::int AS visible, coalesce(sum(s.reps * s.load_kg) FILTER (WHERE NOT s.warmup), 0)::float8 AS tonnage
  FROM workout_sets s JOIN workouts w ON w.id = s.workout_id WHERE w.status = 'completed' AND s.logged_at IS NOT NULL`;

const orderBefore = `SELECT workout_id, array_agg(id ORDER BY position, id) AS ids FROM workout_sets GROUP BY workout_id`;

let figuresBefore: Awaited<ReturnType<typeof figures>>;
let orderSnapshot: Map<string, string[]>;
let unstamped: string[];
let lastStamp: Map<string, string>;
let secondRun: string;

before(async () => {
  if (skip) return;
  legacy = await isolatedSchema(databaseUrl!);
  empty = await isolatedSchema(databaseUrl!);
  await legacy.run(legacySql);
  figuresBefore = await figures();
  orderSnapshot = new Map((await legacy.rows<{ workout_id: string; ids: string[] }>(orderBefore)).map((row) => [row.workout_id, row.ids]));
  unstamped = (await legacy.rows<{ id: string }>(
    `SELECT s.id FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
      WHERE w.status <> 'template' AND s.logged_at IS NULL
        AND (s.reps IS NOT NULL OR s.load_kg IS NOT NULL OR s.rpe IS NOT NULL OR s.duration_seconds IS NOT NULL
          OR s.distance_meters IS NOT NULL OR s.custom_values <> '{}'::jsonb)`,
  )).map((row) => row.id);
  lastStamp = new Map((await legacy.rows<{ workout_id: string; last: string }>(
    "SELECT workout_id, max(logged_at)::text AS last FROM workout_sets WHERE logged_at IS NOT NULL GROUP BY workout_id",
  )).map((row) => [row.workout_id, row.last]));
  await legacy.run(schemaSql);
  secondRun = JSON.stringify(await snapshot());
  await legacy.run(schemaSql);
});

after(async () => {
  if (skip) return;
  await legacy.drop();
  await empty.drop();
});

async function snapshot() {
  return {
    exercises: await legacy.rows("SELECT * FROM exercises ORDER BY id"),
    workouts: await legacy.rows("SELECT * FROM workouts ORDER BY id"),
    blocks: await legacy.rows("SELECT id, workout_id, exercise_id, position FROM workout_exercises ORDER BY id"),
    sets: await legacy.rows("SELECT * FROM workout_sets ORDER BY id"),
    migrations: await legacy.rows("SELECT name FROM schema_migrations ORDER BY name"),
  };
}

test("the fixture is the legacy shape with real data in it", { skip }, () => {
  assert.ok(figuresBefore.workouts > 20);
  assert.ok(figuresBefore.sets > 300);
  assert.ok(figuresBefore.visible > 0);
});

test("migrating loses no workouts or sets and keeps the public numbers", { skip }, async () => {
  const now = await figures();
  assert.equal(now.workouts, figuresBefore.workouts);
  assert.equal(now.sets, figuresBefore.sets);
  const [visible] = await legacy.rows<{ visible: number; tonnage: number }>(newVisible);
  assert.equal(visible.visible, figuresBefore.visible);
  assert.equal(visible.tonnage, figuresBefore.tonnage);
});

test("every set belongs to a block of the same workout and exercise", { skip }, async () => {
  const [orphans] = await legacy.rows<{ count: number }>(
    `SELECT count(*)::int AS count FROM workout_sets s
      LEFT JOIN workout_exercises b ON b.id = s.workout_exercise_id
      WHERE b.id IS NULL OR b.workout_id <> s.workout_id OR b.exercise_id <> s.exercise_id`,
  );
  assert.equal(orphans.count, 0);
  const [blocks] = await legacy.rows<{ count: number }>("SELECT count(*)::int AS count FROM workout_exercises");
  assert.ok(blocks.count > 0);
});

test("reading blocks in order then sets in order gives the old set order", { skip }, async () => {
  const rows = await legacy.rows<{ workout_id: string; ids: string[] }>(
    `SELECT s.workout_id, array_agg(s.id ORDER BY b.position, s.position, s.id) AS ids
      FROM workout_sets s JOIN workout_exercises b ON b.id = s.workout_exercise_id GROUP BY s.workout_id`,
  );
  assert.equal(rows.length, orderSnapshot.size);
  for (const row of rows) assert.deepEqual(row.ids, orderSnapshot.get(row.workout_id));
});

test("the same exercise twice in one session stays two blocks when other work sits between", { skip }, async () => {
  const rows = await legacy.rows<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
        SELECT workout_id, exercise_id FROM workout_exercises GROUP BY 1, 2 HAVING count(*) > 1) twice`,
  );
  assert.ok(rows[0].count >= 1);
});

test("a set that had values but no timestamp is now logged", { skip }, async () => {
  assert.ok(unstamped.length >= 1);
  const rows = await legacy.rows<{ id: string }>("SELECT id FROM workout_sets WHERE logged_at IS NOT NULL AND id = ANY($1::uuid[])", [unstamped]);
  assert.equal(rows.length, unstamped.length);
  const [stray] = await legacy.rows<{ count: number }>(
    `SELECT count(*)::int AS count FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
      WHERE w.status <> 'template' AND s.logged_at IS NULL AND (s.reps IS NOT NULL OR s.custom_values <> '{}'::jsonb)`,
  );
  assert.equal(stray.count, 0);
});

test("a backfilled stamp sits inside its session, not at the time of the migration", { skip }, async () => {
  const rows = await legacy.rows<{ workout_id: string; logged_at: string; stamp: string }>(
    "SELECT workout_id, logged_at::text, logged_at::text AS stamp FROM workout_sets WHERE id = ANY($1::uuid[])", [unstamped],
  );
  const withNeighbours = rows.filter((row) => lastStamp.has(row.workout_id));
  assert.ok(withNeighbours.length >= 1);
  for (const row of withNeighbours) assert.equal(row.logged_at, lastStamp.get(row.workout_id));
  const [late] = await legacy.rows<{ count: number }>(
    "SELECT count(*)::int AS count FROM workout_sets s JOIN workouts w ON w.id = s.workout_id WHERE s.id = ANY($1::uuid[]) AND s.logged_at > w.local_day + 2",
    [unstamped],
  );
  assert.equal(late.count, 0);
});

test("exercises received sensible tracking and equipment", { skip }, async () => {
  const rows = await legacy.rows<{ name: string; tracking: string; equipment: string }>("SELECT name, tracking, equipment FROM exercises");
  const by = new Map(rows.map((row) => [row.name, row]));
  assert.equal(by.get("Easy run")?.tracking, "distance_duration");
  assert.equal(by.get("Plank")?.tracking, "duration");
  assert.equal(by.get("Chin-up")?.tracking, "bodyweight_reps");
  assert.equal(by.get("Leg press")?.equipment, "machine");
  assert.equal(by.get("Low-bar squat")?.equipment, "barbell");
  assert.equal(by.get("Low-bar squat")?.tracking, "weight_reps");
});

test("applying the schema again changes nothing", { skip }, async () => {
  assert.equal(JSON.stringify(await snapshot()), secondRun);
  const migrations = await legacy.rows<{ name: string }>("SELECT name FROM schema_migrations");
  assert.equal(migrations.length, 1);
});

test("the schema applies twice to an empty database", { skip }, async () => {
  await empty.run(schemaSql);
  await empty.run(schemaSql);
  const [row] = await empty.rows<{ count: number }>(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'workout_exercises'",
  );
  assert.equal(row.count, 1);
});
