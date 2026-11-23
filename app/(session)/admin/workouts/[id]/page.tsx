import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { syncStaleHealthProviders } from "@/src/lib/health-sync";
import { requireOwner } from "@/src/lib/owner";
import { isId, stockholmDay } from "@/src/lib/workout-doc";
import { exerciseHistory, listExercises, listFields, loadWorkout } from "@/src/lib/workout-store";
import { WorkoutSession } from "./session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireOwner();
  const { id } = await params;
  const workout = isId(id) ? await loadWorkout(id) : null;
  return { title: workout?.title ?? "Session", robots: { index: false, follow: false } };
}

export default async function WorkoutPage({ params, searchParams }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!isId(id)) notFound();
  const workout = await loadWorkout(id);
  if (!workout) notFound();
  after(() => syncStaleHealthProviders());

  const today = stockholmDay();
  const [exercises, fields, histories, query] = await Promise.all([
    listExercises({ includeArchived: true }),
    listFields(),
    exerciseHistory([...new Set(workout.blocks.map((block) => block.exerciseId))], {
      before: workout.day ?? today,
      excludeWorkoutId: id,
    }),
    searchParams,
  ]);
  const error = Array.isArray(query.error) ? query.error[0] : query.error;

  return (
    <WorkoutSession
      key={`${workout.id}:${workout.status}`}
      initial={workout}
      exercises={exercises}
      fields={fields}
      histories={histories}
      today={today}
      notice={error ? error.slice(0, 300) : null}
    />
  );
}
