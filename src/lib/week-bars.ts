// What the home page draws of a week, and where: the lifts the stage plays, the heaviest bar when the week has none of the six, and
// which blocks a session row must not draw again beside itself. Pure, so the page only writes markup and a test can ask it.
// It takes the shapes of `public-data.ts` without importing it, which would open the database.

import { dayLabel } from "./day-format";
import type { MainLift } from "./lift-row";
import { topLifts } from "./lifts";
import { platesPerSide, STANDARD_BAR_KG, type Equipment, type Measures } from "./workout-doc";

type Block = {
  exercise: { name: string; equipment: Equipment; barKg: number | null };
  top: Measures | null;
};
type Session = { day: string; blocks: readonly Block[] };
type BlockOf<S extends Session> = S["blocks"][number];

/** A barbell block whose heaviest set has a load that plates on its bar can make. */
type Drawn<B extends Block> = B & { top: NonNullable<B["top"]> & { load: number } };

function drawable<B extends Block>(block: B): block is Drawn<B> {
  return block.exercise.equipment === "barbell" && block.top !== null && block.top.load !== null &&
    platesPerSide(block.top.load, block.exercise.barKg ?? STANDARD_BAR_KG) !== null;
}

/** The heaviest drawable barbell working set of a week, ties broken by reps. */
export function heaviestBar<S extends Session>(week: { sessions: readonly S[] }): { session: S; block: Drawn<BlockOf<S>> } | null {
  let best: { session: S; block: Drawn<BlockOf<S>> } | null = null;
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      if (!drawable(block)) continue;
      if (!best || block.top.load > best.block.top.load ||
        (block.top.load === best.block.top.load && (block.top.reps ?? 0) > (best.block.top.reps ?? 0))) {
        best = { session, block };
      }
    }
  }
  return best;
}

/** The lifts the stage plays, heaviest first: the top set of each main lift of the week. Empty when the week has none of the six. */
export function stageLifts<S extends Session>(week: { sessions: readonly S[] }): MainLift[] {
  return topLifts<BlockOf<S>, S>(week.sessions).map(({ kind, session, block, load, reps }) => ({
    kind, exercise: block.exercise.name, loadKg: load, barKg: block.exercise.barKg ?? STANDARD_BAR_KG, reps, rpe: block.top?.rpe ?? null,
    day: dayLabel(session.day),
  }));
}

/** The blocks the home page shows above a week's sessions: every main lift on the stage, or else the heaviest bar. */
export function shownAbove<S extends Session>(week: { sessions: readonly S[] }): ReadonlySet<BlockOf<S>> {
  const lifts = topLifts<BlockOf<S>, S>(week.sessions);
  if (lifts.length > 0) return new Set(lifts.map((lift) => lift.block));
  const heaviest = heaviestBar(week);
  return new Set(heaviest ? [heaviest.block] : []);
}

/** The block whose small bar a session row draws: its first drawable block that the page does not already show above the sessions. */
export function barBeside<S extends Session>(session: S, shown?: ReadonlySet<BlockOf<S>>): Drawn<BlockOf<S>> | undefined {
  return session.blocks.filter((block) => !shown?.has(block)).find(drawable);
}
