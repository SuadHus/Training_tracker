"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, transaction } from "../../src/lib/db";
import { requireOwner } from "../../src/lib/owner";
import {
  idInput, numberInput, parseDate, readActualSet, textInput, trainingDay, TrainingInputError,
  type FieldDefinition,
} from "../../src/lib/training-admin";

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
    const day = status === "planned" ? parseDate(form.get("local_day")) : null;
    const rawTemplate = form.get("template_id");
    const templateId = status === "planned" && rawTemplate ? idInput(rawTemplate) : null;
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
        "INSERT INTO workouts (title, local_day, status, template_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [title || templateTitle, day, status, templateId],
      );
      if (templateId) {
        await client.query(
          `INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup)
           SELECT $1, exercise_id, position, target_reps, target_load_kg, warmup
           FROM workout_sets WHERE workout_id = $2`,
          [workout.id, templateId],
        );
      }
      return workout.id;
    });
    return `/admin/workouts/${id}`;
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
    await transaction(async (client) => {
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
          await client.query(
            `INSERT INTO workout_sets (workout_id, exercise_id, position, target_reps, target_load_kg, warmup)
             SELECT $1, $2, next.last_position + series.n, $3, $4, $5
             FROM (SELECT coalesce(max(position), 0) AS last_position FROM workout_sets WHERE workout_id = $1) AS next
             CROSS JOIN generate_series(1, $6::integer) AS series(n)`,
            [workoutId, exercise.id, reps, load, warmup, count],
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
        await client.query(
          `INSERT INTO workout_sets (workout_id, exercise_id, position, reps, load_kg, rpe, warmup, custom_values,
                                     duration_seconds, distance_meters, logged_at, id)
           SELECT $1, $2, coalesce(max(position), 0) + 1, $3, $4, $5, $6, $7::jsonb, $8, $9, now(), $10
           FROM workout_sets WHERE workout_id = $1 ON CONFLICT (id) DO NOTHING`,
          [workoutId, exercise.id, actual.reps, actual.load, actual.rpe, warmup, JSON.stringify(actual.values),
            actual.duration, actual.distance, idInput(form.get("submission_id"))],
        );
      }
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
          "SELECT id FROM workout_sets WHERE workout_id = $1 AND id <> $2 AND (logged_at IS NOT NULL OR reps IS NOT NULL OR duration_seconds IS NOT NULL OR distance_meters IS NOT NULL OR custom_values <> '{}'::jsonb) LIMIT 1",
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
        "SELECT id FROM workout_sets WHERE workout_id = $1 AND (logged_at IS NOT NULL OR reps IS NOT NULL OR duration_seconds IS NOT NULL OR distance_meters IS NOT NULL OR custom_values <> '{}'::jsonb) LIMIT 1",
        [workoutId],
      );
      if (!set.rowCount) throw new TrainingInputError("Log at least one set before completing the workout.");
      await client.query("UPDATE workouts SET status = 'completed' WHERE id = $1", [workoutId]);
    });
  });
}
