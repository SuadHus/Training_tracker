"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { query, transaction } from "../../src/lib/db";
import { requireOwner } from "../../src/lib/owner";
import {
  idInput, moveExerciseGroup, numberInput, parseDate, readActualSet, textInput, trainingDay, TrainingInputError, workoutDate,
  type FieldDefinition,
} from "../../src/lib/training-admin";

const loggedSet = "(logged_at IS NOT NULL OR reps IS NOT NULL OR duration_seconds IS NOT NULL OR distance_meters IS NOT NULL OR custom_values <> '{}'::jsonb)";

function optionalId(form: FormData, name: string) {
  const value = form.get(name);
  return value ? idInput(value) : null;
}

async function insertAfter(
  client: PoolClient, workoutId: string, setId: string | null, exerciseId: string, count = 1,
) {
  if (!setId) {
    const { rows: [row] } = await client.query<{ position: number }>(
      "SELECT coalesce(max(position), 0) AS position FROM workout_sets WHERE workout_id = $1", [workoutId],
    );
    return row.position;
  }
  const { rows: [anchor] } = await client.query<{ position: number }>(
    `WITH ordered AS (
       SELECT id, exercise_id, row_number() OVER (ORDER BY position, id)::int AS position
       FROM workout_sets WHERE workout_id = $1
     ), anchor AS (
       SELECT position FROM ordered WHERE id = $2 AND exercise_id = $3
     ), shifted AS (
       UPDATE workout_sets s
       SET position = o.position + CASE WHEN o.position > a.position THEN $4::int ELSE 0 END
       FROM ordered o CROSS JOIN anchor a
       WHERE s.id = o.id AND s.position <> o.position + CASE WHEN o.position > a.position THEN $4::int ELSE 0 END
     )
     SELECT position FROM anchor`,
    [workoutId, setId, exerciseId, count],
  );
  if (!anchor) throw new TrainingInputError("That exercise block changed. Try again.");
  return anchor.position;
}

async function advanceAfterLog(client: PoolClient, workoutId: string, form: FormData) {
  if (form.get("advance") !== "1") return;
  const { rows: [next] } = await client.query<{ id: string }>(
    `SELECT id FROM workout_sets WHERE workout_id = $1 AND NOT ${loggedSet} ORDER BY position, id LIMIT 1`, [workoutId],
  );
  if (next) return `/admin/workouts/${workoutId}#set-${next.id}`;
}

async function withOwner(path: string, update: () => Promise<string | void>) {
  await requireOwner();
  let next: string | void;
  try {
    next = await update();
  } catch (error) {
    if (!(error instanceof TrainingInputError)) throw error;
    redirect(`${path}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/admin");
  revalidatePath(path);
  revalidatePath("/");
  revalidatePath("/training", "layout");
  if (next) redirect(next);
  if (path !== "/admin") redirect(path);
}

export async function addExercise(form: FormData) {
  await withOwner("/admin", async () => {
    const name = textInput(form, "name", "exercise name", 100, true);
    const type = textInput(form, "type", "exercise type", 40, true);
    const primary = textInput(form, "primary_muscle", "primary muscle", 50, true);
    const secondary = textInput(form, "secondary_muscles", "secondary muscles", 350)
      .split(",").map((muscle) => muscle.trim()).filter(Boolean);
    if (secondary.length > 8 || secondary.some((muscle) => muscle.length > 50)) {
      throw new TrainingInputError("Use up to eight secondary muscles, with at most 50 characters each.");
    }
    await query(
      "INSERT INTO exercises (name, type, primary_muscle, secondary_muscles) VALUES ($1, $2, $3, $4)",
      [name, type, primary, [...new Set(secondary)]],
    );
    return "/admin#exercises";
  });
}

export async function addField(form: FormData) {
  await withOwner("/admin", async () => {
    const label = textInput(form, "label", "field label", 60, true);
    const unit = textInput(form, "unit", "unit", 20);
    const kind = form.get("kind");
    if (kind !== "decimal" && kind !== "integer" && kind !== "text") {
      throw new TrainingInputError("Select a field type.");
    }
    const exercise = form.get("exercise_id");
    const exerciseId = exercise ? idInput(exercise) : null;
    if (exerciseId && !(await query("SELECT id FROM exercises WHERE id = $1", [exerciseId])).rowCount) {
      throw new TrainingInputError("That exercise could not be found.");
    }
    await query(
      "INSERT INTO field_definitions (label, unit, kind, exercise_id) VALUES ($1, $2, $3, $4)",
      [label, unit, kind, exerciseId],
    );
    return "/admin#fields";
  });
}

export async function createWorkout(form: FormData) {
  await withOwner("/admin", async () => {
    const status = form.get("status");
    if (status !== "planned" && status !== "template") throw new TrainingInputError("Choose a workout type.");
    const day = status === "planned" ? workoutDate(form) : null;
    const templateId = status === "planned" ? optionalId(form, "template_id") : null;
    const submissionId = optionalId(form, "submission_id");
    const title = textInput(form, "title", "workout name", 120, !templateId);
    const id = await transaction(async (client) => {
      let templateTitle = "";
      if (templateId) {
        const template = await client.query<{ title: string }>(
          "SELECT title FROM workouts WHERE id = $1 AND status = 'template' FOR UPDATE", [templateId],
        );
        if (!template.rows[0]) throw new TrainingInputError("That template could not be found.");
        templateTitle = template.rows[0].title;
      }
      const { rows: [workout] } = await client.query<{ id: string }>(
        `INSERT INTO workouts (title, local_day, status, template_id, id)
         VALUES ($1, $2, $3, $4, coalesce($5::uuid, gen_random_uuid()))
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [title || templateTitle, day, status, templateId, submissionId],
      );
      if (!workout) return submissionId!;
      if (templateId) {
        await client.query(
          `INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup)
           SELECT $1, exercise_id, row_number() OVER (ORDER BY position, id)::int, target_reps, target_load_kg, warmup
           FROM workout_sets WHERE workout_id = $2`,
          [workout.id, templateId],
        );
      }
      return workout.id;
    });
    return `/admin/workouts/${id}`;
  });
}

export async function saveAsTemplate(rawId: string, form: FormData) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    const title = textInput(form, "title", "template name", 120, true);
    const submissionId = optionalId(form, "submission_id");
    const id = await transaction(async (client) => {
      const { rows: [source] } = await client.query<{ status: string }>(
        "SELECT status FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (!source || source.status === "template") throw new TrainingInputError("Choose a workout to copy.");

      const { rows: [copy] } = await client.query<{ id: string }>(
        `INSERT INTO workouts (title, status, id) VALUES ($1, 'template', coalesce($2::uuid, gen_random_uuid()))
         ON CONFLICT (id) DO NOTHING RETURNING id`, [title, submissionId],
      );
      if (!copy) return submissionId!;
      const { rowCount } = await client.query(
        `INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup)
         SELECT $1, exercise_id, row_number() OVER (ORDER BY position, id)::int,
           CASE WHEN ${loggedSet} THEN reps ELSE target_reps END,
           CASE WHEN ${loggedSet} THEN load_kg ELSE target_load_kg END, warmup
         FROM workout_sets WHERE workout_id = $2`,
        [copy.id, workoutId],
      );
      if (!rowCount) throw new TrainingInputError("Add at least one set before saving the workout as a template.");
      return copy.id;
    });
    return `/admin/workouts/${id}`;
  });
}

export async function moveExercise(
  rawId: string, rawFirstSetId: string, direction: "up" | "down", rawNeighborId: string | null,
) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    if (direction !== "up" && direction !== "down") throw new TrainingInputError("Choose a direction.");
    const firstSetId = idInput(rawFirstSetId);
    const neighborId = rawNeighborId === null ? null : idInput(rawNeighborId);
    await transaction(async (client) => {
      const { rows: [workout] } = await client.query<{ status: string }>(
        "SELECT status FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (!workout || workout.status === "completed") throw new TrainingInputError("This workout cannot be reordered.");
      const { rows } = await client.query<{ id: string; exercise_id: string }>(
        "SELECT id, exercise_id FROM workout_sets WHERE workout_id = $1 ORDER BY position, id", [workoutId],
      );
      const ordered = moveExerciseGroup(rows, firstSetId, direction, neighborId);
      if (ordered === rows) return;
      await client.query(
        `UPDATE workout_sets s SET position = o.position::int
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position)
         WHERE s.id = o.id AND s.workout_id = $2`,
        [ordered.map((set) => set.id), workoutId],
      );
    });
  });
}

export async function updateWorkout(rawId: string, form: FormData) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    const title = textInput(form, "title", "workout name", 120, true);
    const notes = textInput(form, "notes", "workout notes", 4000);
    await transaction(async (client) => {
      const { rows: [workout] } = await client.query<{ status: string }>(
        "SELECT status FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (!workout) throw new TrainingInputError("That workout could not be found.");
      const day = workout.status === "template" ? null : parseDate(form.get("local_day"));
      if (workout.status === "completed" && day && day > trainingDay()) {
        throw new TrainingInputError("Completed workouts must be dated today or earlier.");
      }
      await client.query("UPDATE workouts SET title = $2, local_day = $3, notes = $4 WHERE id = $1", [
        workoutId, title, day, notes,
      ]);
    });
  });
}

export async function saveSet(rawId: string, rawSetId: string | null, form: FormData) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    const setId = rawSetId ? idInput(rawSetId) : null;
    const warmup = form.get("warmup") === "on";
    const mode = form.get("mode");
    if (mode !== "target" && mode !== "actual") throw new TrainingInputError("Choose which values to save.");
    return transaction(async (client) => {
      const { rows: [workout] } = await client.query<{ status: string }>(
        "SELECT status FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (!workout || (workout.status === "template" && mode === "actual") ||
          (workout.status === "completed" && mode === "target")) {
        throw new TrainingInputError("This set cannot be saved in the current workout.");
      }
      const exercise = setId
        ? (await client.query<{ id: string }>(
          "SELECT exercise_id AS id FROM workout_sets WHERE workout_id = $1 AND id = $2", [workoutId, setId],
        )).rows[0]
        : (await client.query<{ id: string }>(
          "SELECT id FROM exercises WHERE id = $1", [idInput(form.get("exercise_id"))],
        )).rows[0];
      if (!exercise) throw new TrainingInputError("That exercise or set could not be found.");
      const afterSetId = setId ? null : optionalId(form, "after_set_id");
      const submissionId = setId ? null : mode === "actual"
        ? idInput(form.get("submission_id"))
        : optionalId(form, "submission_id");
      if (submissionId) {
        const { rows: [existing] } = await client.query<{ workout_id: string }>(
          "SELECT workout_id FROM workout_sets WHERE id = $1", [submissionId],
        );
        if (existing?.workout_id === workoutId) {
          if (mode === "actual") return advanceAfterLog(client, workoutId, form);
          return;
        }
        if (existing) throw new TrainingInputError("That set could not be added. Try again.");
      }

      if (mode === "target") {
        const reps = numberInput(form, "reps", "target reps", 1, 100000, true);
        const load = numberInput(form, "load_kg", "target load", 0, 100000);
        if (setId) {
          await client.query(
            "UPDATE workout_sets SET target_reps = $3, target_load_kg = $4, warmup = $5 WHERE workout_id = $1 AND id = $2",
            [workoutId, setId, reps, load, warmup],
          );
        } else {
          const count = numberInput(form, "count", "number of sets", 1, 20, true) ?? 1;
          const position = await insertAfter(client, workoutId, afterSetId, exercise.id, count);
          await client.query(
            `INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup, id)
             SELECT $1, $2, $3::int + series.n, $4, $5, $6,
               CASE WHEN series.n = 1 THEN coalesce($8::uuid, gen_random_uuid()) ELSE gen_random_uuid() END
             FROM generate_series(1, $7::integer) AS series(n)`,
            [workoutId, exercise.id, position, reps, load, warmup, count, submissionId],
          );
        }
        return;
      }
      const { rows: fields } = await client.query<FieldDefinition>(
        "SELECT id, label, kind FROM field_definitions WHERE exercise_id IS NULL OR exercise_id = $1", [exercise.id],
      );
      const actual = readActualSet(form, fields);
      if (setId) {
        await client.query(
          `UPDATE workout_sets SET reps = $3, load_kg = $4, rpe = $5, warmup = $6, custom_values = $7::jsonb,
               duration_seconds = $8, distance_meters = $9, logged_at = coalesce(logged_at, now())
           WHERE workout_id = $1 AND id = $2`,
          [workoutId, setId, actual.reps, actual.load, actual.rpe, warmup, JSON.stringify(actual.values),
            actual.duration, actual.distance],
        );
      } else {
        const position = await insertAfter(client, workoutId, afterSetId, exercise.id);
        await client.query(
          `INSERT INTO workout_sets (workout_id, exercise_id, position, reps, load_kg, rpe, warmup, custom_values,
                                     duration_seconds, distance_meters, logged_at, id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, now(), $11)`,
          [workoutId, exercise.id, position + 1, actual.reps, actual.load, actual.rpe, warmup, JSON.stringify(actual.values),
            actual.duration, actual.distance, submissionId],
        );
      }
      return advanceAfterLog(client, workoutId, form);
    });
  });
}

export async function duplicateSet(rawId: string, rawSetId: string, form: FormData) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    const setId = idInput(rawSetId);
    const submissionId = idInput(form.get("submission_id"));
    return transaction(async (client) => {
      const { rows: [workout] } = await client.query<{ status: string }>(
        "SELECT status FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (!workout) throw new TrainingInputError("That workout could not be found.");
      const { rows: [existing] } = await client.query<{ workout_id: string }>(
        "SELECT workout_id FROM workout_sets WHERE id = $1", [submissionId],
      );
      if (existing?.workout_id === workoutId) return advanceAfterLog(client, workoutId, form);
      if (existing) throw new TrainingInputError("That set could not be duplicated. Try again.");

      const { rows: [source] } = await client.query<{ exercise_id: string; logged: boolean }>(
        `SELECT exercise_id, ${loggedSet} AS logged FROM workout_sets WHERE workout_id = $1 AND id = $2`,
        [workoutId, setId],
      );
      if (!source) throw new TrainingInputError("That set could not be found.");
      if (workout.status === "completed" && !source.logged) {
        throw new TrainingInputError("Only logged sets can be duplicated on completed workouts.");
      }
      const logged = workout.status !== "template" && source.logged;
      const position = await insertAfter(client, workoutId, setId, source.exercise_id);
      await client.query(
        `INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup, reps, load_kg,
                                   rpe, custom_values, duration_seconds, distance_meters, logged_at, id)
         SELECT workout_id, exercise_id, $3, target_reps, target_load_kg, warmup,
           CASE WHEN $4 THEN reps END, CASE WHEN $4 THEN load_kg END, CASE WHEN $4 THEN rpe END,
           CASE WHEN $4 THEN custom_values ELSE '{}'::jsonb END,
           CASE WHEN $4 THEN duration_seconds END, CASE WHEN $4 THEN distance_meters END,
           CASE WHEN $4 THEN now() END, $5
         FROM workout_sets WHERE workout_id = $1 AND id = $2`,
        [workoutId, setId, position + 1, logged, submissionId],
      );
      if (logged) return advanceAfterLog(client, workoutId, form);
    });
  });
}

export async function removeSet(rawId: string, rawSetId: string) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    const setId = idInput(rawSetId);
    await transaction(async (client) => {
      const { rows: [workout] } = await client.query<{ status: string }>(
        "SELECT status FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (!workout) throw new TrainingInputError("That workout could not be found.");
      if (workout.status === "completed") {
        const otherSet = await client.query(
          `SELECT id FROM workout_sets WHERE workout_id = $1 AND id <> $2 AND ${loggedSet} LIMIT 1`,
          [workoutId, setId],
        );
        if (!otherSet.rowCount) throw new TrainingInputError("Keep at least one logged set on a completed workout.");
      }
      await client.query("DELETE FROM workout_sets WHERE workout_id = $1 AND id = $2", [workoutId, setId]);
    });
  });
}

export async function completeWorkout(rawId: string) {
  const workoutId = idInput(rawId);
  await withOwner(`/admin/workouts/${workoutId}`, async () => {
    await transaction(async (client) => {
      const { rows: [workout] } = await client.query<{ status: string; day: string }>(
        "SELECT status, local_day::text AS day FROM workouts WHERE id = $1 FOR UPDATE", [workoutId],
      );
      if (workout?.status === "completed") return;
      if (workout?.status !== "planned") throw new TrainingInputError("Schedule this workout before completing it.");
      if (workout.day > trainingDay()) throw new TrainingInputError("Use today’s date or an earlier date to publish this workout.");
      const set = await client.query(
        `SELECT id FROM workout_sets WHERE workout_id = $1 AND ${loggedSet} LIMIT 1`,
        [workoutId],
      );
      if (!set.rowCount) throw new TrainingInputError("Log at least one set before completing the workout.");
      await client.query("UPDATE workouts SET status = 'completed' WHERE id = $1", [workoutId]);
    });
  });
}
