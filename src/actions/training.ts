"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "../lib/owner";
import {
  WorkoutInputError, isDay, isId, stockholmDay,
  type Equipment, type ExerciseInfo, type FieldInfo, type FieldKind, type Tracking,
} from "../lib/workout-doc";
import type { ExerciseHistory } from "../lib/workout-edit";
import {
  completeWorkout, copyToTemplate, createWorkout, deleteExercise, deleteField, deleteWorkout, exerciseHistory,
  importTemplates, loadWorkout, reopenWorkout, saveExercise, saveField, saveWorkout, setExerciseArchived,
  type ImportedTemplate, type SaveResult,
} from "../lib/workout-store";

type Failure = { ok: false; message: string };

function refresh() {
  revalidatePath("/");
  revalidatePath("/training", "layout");
  revalidatePath("/admin", "layout");
}

async function attempt<T extends { ok: true }>(work: () => Promise<T>): Promise<T | Failure> {
  try {
    const result = await work();
    refresh();
    return result;
  } catch (error) {
    if (error instanceof WorkoutInputError) return { ok: false, message: error.message };
    throw error;
  }
}

const unreadable: Failure = { ok: false, message: "The request is not readable. Reload the page and try again." };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Run a form action. A WorkoutInputError sends the owner back to `back` with the message. */
async function form(back: string, work: () => Promise<string>): Promise<never> {
  let next: string;
  try {
    next = await work();
  } catch (error) {
    if (!(error instanceof WorkoutInputError)) throw error;
    redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  }
  refresh();
  redirect(next);
}

// Called from the editor and the library; they return values and never redirect.

export async function saveWorkoutAction(id: string, baseRevision: number, draft: unknown): Promise<SaveResult> {
  await requireOwner();
  if (!isId(id) || !Number.isInteger(baseRevision)) {
    return { ok: false, reason: "invalid", message: unreadable.message };
  }
  // No revalidation here: this runs on every autosave, and revalidating would make
  // the server re-render the open session screen each time. Every page reads fresh data anyway.
  return saveWorkout(id, baseRevision, draft);
}

export async function historyAction(
  exerciseIds: string[], before: string | null, excludeWorkoutId: string,
): Promise<Record<string, ExerciseHistory>> {
  await requireOwner();
  if (!Array.isArray(exerciseIds) || exerciseIds.length > 100 || !exerciseIds.every(isId)) return {};
  if (before !== null && !isDay(before)) return {};
  return exerciseHistory(exerciseIds, { before, excludeWorkoutId: isId(excludeWorkoutId) ? excludeWorkoutId : undefined });
}

export async function quickAddExerciseAction(
  input: { name: string; tracking: Tracking; equipment: Equipment; primaryMuscle: string },
): Promise<{ ok: true; exercise: ExerciseInfo } | Failure> {
  await requireOwner();
  if (typeof input !== "object" || input === null) return unreadable;
  const { name, tracking, equipment, primaryMuscle } = input;
  return attempt(async () => ({ ok: true as const, exercise: await saveExercise({ name, tracking, equipment, primaryMuscle }) }));
}

export async function completeWorkoutAction(id: string): Promise<{ ok: true } | Failure> {
  await requireOwner();
  if (!isId(id)) return unreadable;
  return attempt(async () => {
    await completeWorkout(id);
    return { ok: true as const };
  });
}

export async function reopenWorkoutAction(id: string): Promise<{ ok: true } | Failure> {
  await requireOwner();
  if (!isId(id)) return unreadable;
  return attempt(async () => {
    await reopenWorkout(id);
    return { ok: true as const };
  });
}

export async function saveExerciseAction(
  input: Parameters<typeof saveExercise>[0],
): Promise<{ ok: true; exercise: ExerciseInfo } | Failure> {
  await requireOwner();
  if (typeof input !== "object" || input === null) return unreadable;
  const { id, name, tracking, equipment, barKg, restSeconds, primaryMuscle, secondaryMuscles, notes } = input;
  return attempt(async () => ({
    ok: true as const,
    exercise: await saveExercise({ id, name, tracking, equipment, barKg, restSeconds, primaryMuscle, secondaryMuscles, notes }),
  }));
}

export async function archiveExerciseAction(id: string, archived: boolean): Promise<{ ok: true } | Failure> {
  await requireOwner();
  if (!isId(id) || typeof archived !== "boolean") return unreadable;
  return attempt(async () => {
    await setExerciseArchived(id, archived);
    return { ok: true as const };
  });
}

export async function deleteExerciseAction(id: string): Promise<{ ok: true; result: "deleted" | "in_use" } | Failure> {
  await requireOwner();
  if (!isId(id)) return unreadable;
  return attempt(async () => ({ ok: true as const, result: await deleteExercise(id) }));
}

export async function saveFieldAction(
  input: Parameters<typeof saveField>[0],
): Promise<{ ok: true; field: FieldInfo } | Failure> {
  await requireOwner();
  if (typeof input !== "object" || input === null) return unreadable;
  const { id, label, unit, kind, exerciseId } = input;
  return attempt(async () => ({ ok: true as const, field: await saveField({ id, label, unit, kind: kind as FieldKind, exerciseId }) }));
}

export async function deleteFieldAction(id: string): Promise<{ ok: true } | Failure> {
  await requireOwner();
  if (!isId(id)) return unreadable;
  return attempt(async () => {
    await deleteField(id);
    return { ok: true as const };
  });
}

export async function importSheetAction(
  text: string, picks: Array<{ index: number; title: string }>,
): Promise<{ ok: true; templates: ImportedTemplate[]; newExercises: string[] } | Failure> {
  await requireOwner();
  return attempt(async () => ({ ok: true as const, ...(await importTemplates(text, picks)) }));
}

// Forms: FormData in, redirect out.

export async function startWorkoutAction(data: FormData): Promise<void> {
  await requireOwner();
  await form("/admin", async () => {
    const kind = text(data, "kind");
    if (kind !== "planned" && kind !== "template") throw new WorkoutInputError("Choose a session or a template.");
    const when = text(data, "when");
    const day = when === "today" ? stockholmDay() : text(data, "day");
    const templateId = text(data, "template_id");
    const id = await createWorkout({
      id: text(data, "id") || undefined,
      status: kind,
      title: text(data, "title"),
      day: kind === "planned" ? day : null,
      templateId: templateId || null,
    });
    return `/admin/workouts/${id}`;
  });
}

export async function saveAsTemplateAction(data: FormData): Promise<void> {
  await requireOwner();
  const workoutId = text(data, "workout_id");
  await form(isId(workoutId) ? `/admin/workouts/${workoutId}` : "/admin", async () => {
    const id = await copyToTemplate(workoutId, { id: text(data, "id") || undefined, title: text(data, "title") });
    return `/admin/workouts/${id}`;
  });
}

export async function deleteWorkoutAction(data: FormData): Promise<void> {
  await requireOwner();
  const workoutId = text(data, "workout_id");
  await form("/admin", async () => {
    if (!isId(workoutId)) throw new WorkoutInputError("That session no longer exists.");
    const workout = await loadWorkout(workoutId);
    await deleteWorkout(workoutId);
    return workout?.status === "template" ? "/admin/templates" : "/admin";
  });
}
