"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/src/lib/owner";
import { starterExercises } from "@/src/lib/starter-exercises";
import { listExercises, saveExercise } from "@/src/lib/workout-store";

/** Adds every starter exercise whose name is not in the library yet, archived ones included. */
export async function addStarterExercisesAction(): Promise<void> {
  await requireOwner();
  const have = new Set((await listExercises({ includeArchived: true })).map(({ name }) => name.toLowerCase()));
  for (const exercise of starterExercises) {
    if (have.has(exercise.name.toLowerCase())) continue;
    await saveExercise(exercise);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/training", "layout");
}
