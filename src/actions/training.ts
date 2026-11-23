"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  addBlockSession, addBlockWeek, createBlock, deleteBlock, importBlock, removeBlockWeek, renameBlock,
} from "../lib/block-store";
import { syncStaleHealthProviders } from "../lib/health-sync";
import { requireOwner } from "../lib/owner";
import {
  WorkoutInputError, isDay, isId, stockholmDay,
  type Equipment, type ExerciseInfo, type FieldInfo, type FieldKind, type Tracking,
} from "../lib/workout-doc";
import type { ExerciseHistory } from "../lib/workout-edit";
import {
  completeWorkout, copyToTemplate, createWorkout, deleteExercise, deleteField, deleteWorkout, exerciseHistory,
  importTemplates, loadWorkout, reopenWorkout, saveExercise, saveField, setExerciseArchived,
  type ImportedTemplate,
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

// Saving a workout does not go through an action: see app/api/workouts/[id]/save/route.ts.

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

async function waitBriefly(work: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function completeWorkoutAction(id: string): Promise<{ ok: true } | Failure> {
  await requireOwner();
  if (!isId(id)) return unreadable;
  return attempt(async () => {
    await completeWorkout(id);
    const sync = syncStaleHealthProviders();
    try {
      after(() => sync.then(() => undefined, () => undefined));
    } catch {
      // Allow calling outside a Next.js request context.
    }
    await waitBriefly(sync, 2500);
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

export async function importBlockAction(
  text: string, options: { title: string; startDay: string; newestFirst: boolean },
): Promise<{ ok: true; id: string; sessions: number; weeks: number; newExercises: string[] } | Failure> {
  await requireOwner();
  if (typeof options !== "object" || options === null) return unreadable;
  const { title, startDay, newestFirst } = options;
  return attempt(async () => ({ ok: true as const, ...(await importBlock(text, { title, startDay, newestFirst })) }));
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

export async function createBlockAction(data: FormData): Promise<void> {
  await requireOwner();
  await form("/admin/blocks", async () => {
    const layout = [0, 1, 2, 3, 4, 5, 6].flatMap((offset) => {
      const templateId = text(data, `day_${offset}`);
      return templateId ? [{ offset, templateId }] : [];
    });
    const id = await createBlock({
      title: text(data, "title"), startDay: text(data, "start"), weeks: Number(text(data, "weeks")), addKg: text(data, "add_kg").replace(",", "."), layout,
    });
    return `/admin/blocks/${id}`;
  });
}

export async function addBlockWeekAction(data: FormData): Promise<void> {
  await requireOwner();
  const blockId = text(data, "block_id");
  await form(isId(blockId) ? `/admin/blocks/${blockId}` : "/admin/blocks", async () => {
    await addBlockWeek(blockId, text(data, "add_kg").replace(",", "."));
    return `/admin/blocks/${blockId}`;
  });
}

export async function addBlockSessionAction(data: FormData): Promise<void> {
  await requireOwner();
  const blockId = text(data, "block_id");
  await form(isId(blockId) ? `/admin/blocks/${blockId}` : "/admin/blocks", async () => {
    await addBlockSession(blockId, { day: text(data, "day"), templateId: text(data, "template_id") });
    return `/admin/blocks/${blockId}`;
  });
}

export async function removeBlockWeekAction(data: FormData): Promise<void> {
  await requireOwner();
  const blockId = text(data, "block_id");
  await form(isId(blockId) ? `/admin/blocks/${blockId}` : "/admin/blocks", async () => {
    await removeBlockWeek(blockId);
    return `/admin/blocks/${blockId}`;
  });
}

export async function renameBlockAction(data: FormData): Promise<void> {
  await requireOwner();
  const blockId = text(data, "block_id");
  await form(isId(blockId) ? `/admin/blocks/${blockId}` : "/admin/blocks", async () => {
    await renameBlock(blockId, text(data, "title"), text(data, "notes"));
    return `/admin/blocks/${blockId}`;
  });
}

export async function deleteBlockAction(data: FormData): Promise<void> {
  await requireOwner();
  await form("/admin/blocks", async () => {
    await deleteBlock(text(data, "block_id"));
    return "/admin/blocks";
  });
}
