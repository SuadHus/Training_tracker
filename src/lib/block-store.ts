// Training blocks: a named run of weeks whose sessions are ordinary planned workouts.
// Server only: this module talks to the database.
import type { PoolClient } from "pg";
import { dateLabel } from "./day-format";
import { query, transaction } from "./db";
import {
  buildDraft, guessExercise, parseSheet, planBlock, sessionName, sheetKey, sheetLimits, type SheetRow,
} from "./sheet-import";
import {
  WorkoutInputError, addDays, isDay, isId, limits, rejectNul, stockholmDay, type Tracking,
} from "./workout-doc";
import { createWorkout, listExercises, saveExercise, saveWorkout } from "./workout-store";

export const blockLimits = { weeks: sheetLimits.weeks, stepKg: 50 } as const;

export type BlockSummary = {
  id: string; title: string; startDay: string; weeks: number; notes: string;
  sessions: number; completed: number;
};

/** One exercise of a session in the week view: what was planned, and what was done once it is logged. */
export type BlockLine = { exercise: string; tracking: Tracking; planned: SheetRow[]; done: SheetRow[] };
export type BlockSession = {
  id: string; title: string; day: string; status: "planned" | "completed";
  setCount: number; loggedCount: number; lines: BlockLine[];
};
export type BlockWeek = { week: number; start: string; sessions: BlockSession[] };
export type BlockView = BlockSummary & { weekList: BlockWeek[] };

const summaryColumns = `b.id, b.title, b.start_day::text AS start_day, b.weeks, b.notes,
  (SELECT count(*) FROM workouts w WHERE w.block_id = b.id)::int AS sessions,
  (SELECT count(*) FROM workouts w WHERE w.block_id = b.id AND w.status = 'completed')::int AS completed`;

type SummaryRow = { id: string; title: string; start_day: string; weeks: number; notes: string; sessions: number; completed: number };

const summaryFrom = (row: SummaryRow): BlockSummary => ({
  id: row.id, title: row.title, startDay: row.start_day, weeks: row.weeks, notes: row.notes,
  sessions: row.sessions, completed: row.completed,
});

/** Every block, the one that starts last first. */
export async function listBlocks(): Promise<BlockSummary[]> {
  const { rows } = await query<SummaryRow>(`SELECT ${summaryColumns} FROM training_blocks b ORDER BY b.start_day DESC, b.created_at DESC`);
  return rows.map(summaryFrom);
}

/** The week of a block a day falls in, from 1, or null when the day is outside it. */
export function weekOfBlock(block: Pick<BlockSummary, "startDay" | "weeks">, day: string): number | null {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${block.startDay}T00:00:00Z`)) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  return days >= 0 && week <= block.weeks ? week : null;
}

function runs(sets: Array<Omit<SheetRow, "count">>): SheetRow[] {
  const found: SheetRow[] = [];
  for (const set of sets) {
    const last = found.at(-1);
    if (last && last.reps === set.reps && last.repsMax === set.repsMax && last.load === set.load &&
      last.rpe === set.rpe && last.duration === set.duration) last.count += 1;
    else found.push({ ...set, count: 1 });
  }
  return found;
}

export async function loadBlock(id: string): Promise<BlockView | null> {
  if (!isId(id)) return null;
  const { rows: [block] } = await query<SummaryRow>(`SELECT ${summaryColumns} FROM training_blocks b WHERE b.id = $1`, [id]);
  if (!block) return null;
  const [{ rows: sessions }, { rows: sets }] = await Promise.all([
    query<{ id: string; title: string; day: string; status: "planned" | "completed"; week: number }>(
      `SELECT id, title, local_day::text AS day, status, block_week AS week FROM workouts
        WHERE block_id = $1 AND status <> 'template' ORDER BY block_week, local_day, created_at, id`, [id],
    ),
    query<{
      workout_id: string; block_id: string; name: string; tracking: Tracking; logged: boolean;
      t_reps: number | null; t_reps_max: number | null; t_load: number | null; t_rpe: number | null; t_duration: number | null;
      a_reps: number | null; a_load: number | null; a_rpe: number | null; a_duration: number | null;
    }>(
      `SELECT s.workout_id, s.workout_exercise_id AS block_id, e.name, e.tracking, (s.logged_at IS NOT NULL) AS logged,
          s.target_reps AS t_reps, s.target_reps_max AS t_reps_max, s.target_load_kg::float8 AS t_load,
          s.target_rpe::float8 AS t_rpe, s.target_duration_seconds::float8 AS t_duration,
          s.reps AS a_reps, s.load_kg::float8 AS a_load, s.rpe::float8 AS a_rpe, s.duration_seconds::float8 AS a_duration
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id AND w.block_id = $1
        JOIN workout_exercises b ON b.id = s.workout_exercise_id JOIN exercises e ON e.id = s.exercise_id
        ORDER BY s.workout_id, b.position, s.position, s.id`, [id],
    ),
  ]);

  const linesOf = new Map<string, Map<string, { line: BlockLine; planned: Array<Omit<SheetRow, "count">>; done: Array<Omit<SheetRow, "count">> }>>();
  const counts = new Map<string, { sets: number; logged: number }>();
  for (const set of sets) {
    const blocks = linesOf.get(set.workout_id) ?? new Map();
    linesOf.set(set.workout_id, blocks);
    const entry = blocks.get(set.block_id) ?? { line: { exercise: set.name, tracking: set.tracking, planned: [], done: [] }, planned: [], done: [] };
    blocks.set(set.block_id, entry);
    entry.planned.push({ reps: set.t_reps, repsMax: set.t_reps_max, load: set.t_load, rpe: set.t_rpe, duration: set.t_duration });
    if (set.logged) entry.done.push({ reps: set.a_reps, repsMax: null, load: set.a_load, rpe: set.a_rpe, duration: set.a_duration });
    const count = counts.get(set.workout_id) ?? { sets: 0, logged: 0 };
    count.sets += 1;
    if (set.logged) count.logged += 1;
    counts.set(set.workout_id, count);
  }

  const weekList: BlockWeek[] = Array.from({ length: block.weeks }, (_, index) => ({
    week: index + 1, start: addDays(block.start_day, 7 * index), sessions: [],
  }));
  for (const session of sessions) {
    const week = weekList[Math.min(Math.max(session.week ?? 1, 1), block.weeks) - 1];
    week.sessions.push({
      id: session.id, title: session.title, day: session.day, status: session.status,
      setCount: counts.get(session.id)?.sets ?? 0, loggedCount: counts.get(session.id)?.logged ?? 0,
      lines: [...(linesOf.get(session.id)?.values() ?? [])].map(({ line, planned, done }) => ({ ...line, planned: runs(planned), done: runs(done) })),
    });
  }
  return { ...summaryFrom(block), weekList };
}

/** The block that holds today, for the desk. */
export async function currentBlock(today = stockholmDay()): Promise<(BlockSummary & { week: number }) | null> {
  const { rows: [row] } = await query<SummaryRow>(
    `SELECT ${summaryColumns} FROM training_blocks b
      WHERE b.start_day <= $1::date AND $1::date < b.start_day + b.weeks * 7 ORDER BY b.start_day DESC, b.created_at DESC LIMIT 1`, [today],
  );
  if (!row) return null;
  const block = summaryFrom(row);
  return { ...block, week: weekOfBlock(block, today)! };
}

function named(value: unknown): string {
  if (typeof value !== "string") throw new WorkoutInputError("Give the block a name.");
  const title = rejectNul(value, "The name").trim();
  if (!title) throw new WorkoutInputError("Give the block a name.");
  if (title.length > limits.title) throw new WorkoutInputError(`The name can be at most ${limits.title} characters.`);
  return title;
}

function firstDay(value: unknown): string {
  if (!isDay(value)) throw new WorkoutInputError("Enter a valid start date.");
  return value;
}

function step(value: unknown): number {
  const kg = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(kg) || kg < 0 || kg > blockLimits.stepKg) {
    throw new WorkoutInputError(`The weekly increase must be between 0 and ${blockLimits.stepKg} kg.`);
  }
  return Math.round(kg * 1000) / 1000;
}

/**
 * Copy the plan of a workout (its exercises and target sets) into a new planned session of a block.
 * `addKg` goes on every target load; a set planned without a load stays without one.
 */
async function copyPlan(
  client: PoolClient, sourceId: string, target: { day: string; blockId: string; week: number; addKg: number },
): Promise<string> {
  const id = crypto.randomUUID();
  const { rowCount } = await client.query(
    `INSERT INTO workouts (id, title, local_day, status, template_id, block_id, block_week)
      SELECT $1, title, $3::date, 'planned', CASE WHEN status = 'template' THEN id ELSE template_id END, $4, $5
      FROM workouts WHERE id = $2`,
    [id, sourceId, target.day, target.blockId, target.week],
  );
  if (!rowCount) throw new WorkoutInputError("A template in this block no longer exists. Reload the page and try again.");
  await client.query(
    `WITH map AS (
        SELECT id AS old_id, gen_random_uuid() AS new_id, exercise_id, position, notes, rest_seconds
        FROM workout_exercises WHERE workout_id = $2
      ), blocks AS (
        INSERT INTO workout_exercises (id, workout_id, exercise_id, position, notes, rest_seconds)
        SELECT new_id, $1, exercise_id, position, notes, rest_seconds FROM map
      )
      INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, position, warmup, target_reps,
          target_reps_max, target_load_kg, target_rpe, target_duration_seconds, target_distance_meters)
      SELECT gen_random_uuid(), $1, m.new_id, m.exercise_id, s.position, s.warmup, s.target_reps, s.target_reps_max,
        CASE WHEN s.target_load_kg IS NULL THEN NULL ELSE LEAST(s.target_load_kg + $3::numeric, $4::numeric) END,
        s.target_rpe, s.target_duration_seconds, s.target_distance_meters
      FROM workout_sets s JOIN map m ON m.old_id = s.workout_exercise_id`,
    [id, sourceId, target.addKg, limits.loadKg],
  );
  return id;
}

/**
 * Build a block from templates: `layout` says which template is trained on which day of
 * the week (the block's first day is 0), and every week repeats it. `addKg` is added to
 * every target load once per week after the first.
 */
export async function createBlock(input: {
  title: unknown; startDay: unknown; weeks: unknown; addKg?: unknown; layout: Array<{ offset: number; templateId: string }>;
}): Promise<string> {
  const title = named(input.title);
  const startDay = firstDay(input.startDay);
  const weeks = Number(input.weeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > blockLimits.weeks) {
    throw new WorkoutInputError(`A block can run from 1 to ${blockLimits.weeks} weeks.`);
  }
  const addKg = step(input.addKg);
  const layout = input.layout.filter(({ offset, templateId }) => Number.isInteger(offset) && offset >= 0 && offset <= 6 && isId(templateId));
  if (!layout.length) throw new WorkoutInputError("Choose a template for at least one day of the week.");
  layout.sort((a, b) => a.offset - b.offset);

  return transaction(async (client) => {
    const { rows: found } = await client.query<{ id: string }>(
      "SELECT id FROM workouts WHERE status = 'template' AND id = ANY($1::uuid[])", [layout.map(({ templateId }) => templateId)],
    );
    if (found.length !== new Set(layout.map(({ templateId }) => templateId)).size) {
      throw new WorkoutInputError("A chosen template no longer exists. Reload the page and try again.");
    }
    const { rows: [block] } = await client.query<{ id: string }>(
      "INSERT INTO training_blocks (title, start_day, weeks) VALUES ($1, $2::date, $3) RETURNING id", [title, startDay, weeks],
    );
    for (let week = 1; week <= weeks; week += 1) {
      for (const { offset, templateId } of layout) {
        await copyPlan(client, templateId, {
          day: addDays(startDay, 7 * (week - 1) + offset), blockId: block.id, week, addKg: addKg * (week - 1),
        });
      }
    }
    return block.id;
  });
}

/** Add a week to the end of a block: the last week again, a week later, with `addKg` on every load. */
export async function addBlockWeek(id: string, addKg: unknown): Promise<void> {
  const more = step(addKg);
  await transaction(async (client) => {
    const { rows: [block] } = await client.query<{ weeks: number }>(
      "SELECT weeks FROM training_blocks WHERE id = $1 FOR UPDATE", [isId(id) ? id : null],
    );
    if (!block) throw new WorkoutInputError("That block no longer exists.");
    if (block.weeks >= blockLimits.weeks) throw new WorkoutInputError(`A block can run for at most ${blockLimits.weeks} weeks.`);
    const { rows: last } = await client.query<{ id: string; day: string }>(
      `SELECT id, local_day::text AS day FROM workouts WHERE block_id = $1 AND block_week = $2 AND status <> 'template'
        ORDER BY local_day, created_at, id`, [id, block.weeks],
    );
    if (!last.length) throw new WorkoutInputError("The last week has no sessions to repeat. Add a session to it first.");
    for (const session of last) {
      await copyPlan(client, session.id, { day: addDays(session.day, 7), blockId: id, week: block.weeks + 1, addKg: more });
    }
    await client.query("UPDATE training_blocks SET weeks = weeks + 1 WHERE id = $1", [id]);
  });
}

/**
 * Plan one more session in a block, on a day inside it: a copy of a template, or an empty
 * session when no template is given. The day decides the week. Returns the new session.
 */
export async function addBlockSession(id: string, input: { day: unknown; templateId?: unknown }): Promise<string> {
  const day = isDay(input.day) ? input.day : null;
  if (!day) throw new WorkoutInputError("Enter a valid date for the session.");
  const templateId = input.templateId === undefined || input.templateId === null || input.templateId === "" ? null : input.templateId;
  if (templateId !== null && !isId(templateId)) throw new WorkoutInputError("That template no longer exists.");
  return transaction(async (client) => {
    const { rows: [block] } = await client.query<{ weeks: number; start_day: string }>(
      "SELECT weeks, start_day::text AS start_day FROM training_blocks WHERE id = $1 FOR UPDATE", [isId(id) ? id : null],
    );
    if (!block) throw new WorkoutInputError("That block no longer exists.");
    const week = weekOfBlock({ startDay: block.start_day, weeks: block.weeks }, day);
    if (!week) {
      const last = addDays(block.start_day, block.weeks * 7 - 1);
      throw new WorkoutInputError(`This block runs from ${dateLabel(block.start_day)} to ${dateLabel(last)}. Choose a day in it, or add a week first.`);
    }
    if (templateId) {
      const { rows: [template] } = await client.query("SELECT 1 FROM workouts WHERE id = $1 AND status = 'template'", [templateId]);
      if (!template) throw new WorkoutInputError("That template no longer exists.");
      return copyPlan(client, templateId, { day, blockId: id, week, addKg: 0 });
    }
    const session = crypto.randomUUID();
    await client.query(
      "INSERT INTO workouts (id, title, local_day, status, block_id, block_week) VALUES ($1, 'Session', $2::date, 'planned', $3, $4)",
      [session, day, id, week],
    );
    return session;
  });
}

/**
 * Take the last week off a block, with its sessions. Refused while that week holds a
 * session that was trained: a block never deletes logged work.
 */
export async function removeBlockWeek(id: string): Promise<void> {
  await transaction(async (client) => {
    const { rows: [block] } = await client.query<{ weeks: number }>(
      "SELECT weeks FROM training_blocks WHERE id = $1 FOR UPDATE", [isId(id) ? id : null],
    );
    if (!block) throw new WorkoutInputError("That block no longer exists.");
    if (block.weeks <= 1) throw new WorkoutInputError("A block has at least one week. Delete the block instead.");
    const { rows: [kept] } = await client.query(
      `SELECT 1 FROM workouts w WHERE w.block_id = $1 AND w.block_week >= $2 AND (w.status = 'completed'
          OR EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_id = w.id AND s.logged_at IS NOT NULL)) LIMIT 1`, [id, block.weeks],
    );
    if (kept) throw new WorkoutInputError(`Week ${block.weeks} has a session you trained, so it stays.`);
    await client.query("DELETE FROM workouts WHERE block_id = $1 AND block_week >= $2 AND status = 'planned'", [id, block.weeks]);
    await client.query("UPDATE training_blocks SET weeks = weeks - 1 WHERE id = $1", [id]);
  });
}

export async function renameBlock(id: string, title: unknown, notes: unknown): Promise<void> {
  const name = named(title);
  const text = typeof notes === "string" ? rejectNul(notes, "Notes").trim() : "";
  if (text.length > limits.notes) throw new WorkoutInputError(`Notes can be at most ${limits.notes} characters.`);
  await query("UPDATE training_blocks SET title = $2, notes = $3 WHERE id = $1", [isId(id) ? id : null, name, text]);
}

/** Delete a block. Sessions that were never started go with it; trained ones stay in the log. */
export async function deleteBlock(id: string): Promise<void> {
  if (!isId(id)) return;
  await transaction(async (client) => {
    await client.query(
      `DELETE FROM workouts w WHERE w.block_id = $1 AND w.status = 'planned'
        AND NOT EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_id = w.id AND s.logged_at IS NOT NULL)`, [id],
    );
    await client.query("UPDATE workouts SET block_week = NULL WHERE block_id = $1", [id]);
    await client.query("DELETE FROM training_blocks WHERE id = $1", [id]);
  });
}

/**
 * Create a block from rows pasted out of a spreadsheet: each stacked group is a week,
 * each workout in it a session, dated from `startDay` on. Exercises the library does
 * not know are added.
 */
export async function importBlock(
  text: unknown, options: { title: unknown; startDay: unknown; newestFirst?: unknown },
): Promise<{ id: string; sessions: number; weeks: number; newExercises: string[] }> {
  if (typeof text !== "string" || !text.trim()) throw new WorkoutInputError("Paste the rows from your spreadsheet first.");
  if (text.length > sheetLimits.characters) throw new WorkoutInputError("That is too much text for one import. Paste fewer weeks at a time.");
  const title = named(options.title);
  const startDay = firstDay(options.startDay);
  const workouts = parseSheet(rejectNul(text, "The pasted text"));
  const plan = planBlock(workouts, startDay, options.newestFirst === true);
  if (!plan.length) throw new WorkoutInputError("No workouts found in that text. Each row needs an exercise name in its first cell.");

  const library = new Map((await listExercises({ includeArchived: true })).map((exercise) => [sheetKey(exercise.name), exercise]));
  const newExercises: string[] = [];
  for (const { sessions } of plan) {
    for (const { index } of sessions) {
      for (const entry of workouts[index].entries) {
        if (library.has(sheetKey(entry.name))) continue;
        const exercise = await saveExercise({ name: entry.name.slice(0, 100), ...guessExercise(entry) });
        library.set(sheetKey(entry.name), exercise);
        newExercises.push(exercise.name);
      }
    }
  }

  const { rows: [block] } = await query<{ id: string }>(
    "INSERT INTO training_blocks (title, start_day, weeks) VALUES ($1, $2::date, $3) RETURNING id", [title, startDay, plan.length],
  );
  const made: string[] = [];
  try {
    for (const { week, sessions } of plan) {
      for (const { index, day } of sessions) {
        const workout = workouts[index];
        const name = sessionName(workout);
        const id = await createWorkout({ status: "planned", title: name, day });
        made.push(id);
        const draft = { ...buildDraft(workout, name, (entry) => library.get(sheetKey(entry.name))!), day };
        const saved = await saveWorkout(id, 0, draft);
        if (!saved.ok) {
          throw new WorkoutInputError(saved.reason === "invalid" ? `${name}: ${saved.message}` : `${name} could not be saved. Try again.`);
        }
        await query("UPDATE workouts SET block_id = $2, block_week = $3 WHERE id = $1", [id, block.id, week]);
      }
    }
  } catch (error) {
    // Nothing of a failed import stays behind: not the block, not a session that was not linked to it yet.
    await query("DELETE FROM workouts WHERE id = ANY($1::uuid[]) AND status = 'planned'", [made]);
    await query("DELETE FROM training_blocks WHERE id = $1", [block.id]);
    throw error;
  }
  return { id: block.id, sessions: made.length, weeks: plan.length, newExercises };
}
