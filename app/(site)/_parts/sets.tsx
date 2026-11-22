import { Fragment, type ReactNode } from "react";
import { BarLoad } from "@/app/ui/bar-load";
import { Clock, Notation, Num } from "@/app/ui/notation";
import type { PublicBlock, PublicSet } from "@/src/lib/public-data";
import {
  formatDistance, formatNumber, type Measures, platesPerSide, STANDARD_BAR_KG, topSet, type FieldInfo,
} from "@/src/lib/workout-doc";
import styles from "../public.module.css";

/** Whether a set carries anything Notation can write. */
export function hasValue({ load, reps, duration, distance }: Measures): boolean {
  return load !== null || reps !== null || duration !== null || distance !== null;
}

/** One decimal, with the point kept narrow: 83.6, 7.0. */
export function Dec({ value }: { value: number }) {
  const [whole, fraction] = value.toFixed(1).split(".");
  return <span className="num">{whole}<span className="sep">.</span>{fraction}</span>;
}

/** The block's top set, only when it can be drawn as plates on the bar. */
export function topOf(block: PublicBlock): { load: number } | null {
  if (block.exercise.equipment !== "barbell") return null;
  const top = topSet(block.sets.map((set) => ({ warmup: set.warmup, actual: set.measures, loggedAt: "logged" })));
  const load = top?.actual.load ?? null;
  if (load === null || platesPerSide(load, block.exercise.barKg ?? STANDARD_BAR_KG) === null) return null;
  return { load };
}

type Column = { head: ReactNode; className?: string; cell: (set: PublicSet) => ReactNode };

// Every table has five fixed slots (set, a, b, c, bar) so that kg, reps and RPE
// stand at the same x in every exercise. A table that uses fewer fills the rest.
const slots = 5;

export function notedFields(block: PublicBlock, fields: FieldInfo[]): FieldInfo[] {
  return fields.filter((field) => (field.exerciseId === null || field.exerciseId === block.exercise.id) &&
    block.sets.some((set) => set.custom[field.id] !== undefined && set.custom[field.id] !== ""));
}

export function SetTable({ block, fields }: { block: PublicBlock; fields: FieldInfo[] }) {
  const { exercise, sets } = block;
  const barbell = exercise.equipment === "barbell";
  const noted = notedFields(block, fields);

  let working = 0;
  const numbers = new Map(sets.map((set) => [set.id, set.warmup ? "W" : String(++working)]));

  const rpe: Column = {
    head: "RPE", className: styles.cRpe,
    cell: ({ measures }) => measures.rpe === null ? null : <Num value={measures.rpe} />,
  };
  const bar: Column = {
    head: <span className="sr">Bar</span>, className: styles.cBar,
    cell: ({ measures }) => barbell && measures.load !== null
      ? <BarLoad load={measures.load} barKg={exercise.barKg} size="inline" /> : null,
  };
  const reps = (loaded: (set: PublicSet) => boolean): Column => ({
    head: "Reps", className: styles.cReps,
    cell: (set) => set.measures.reps === null ? null : <>
      {loaded(set) && <span className={styles.times} aria-hidden="true">×</span>}{set.measures.reps}
    </>,
  });

  let columns: Column[];
  if (exercise.tracking === "duration") {
    columns = [{ head: "Time", className: styles.cValue, cell: ({ measures }) => measures.duration === null ? null : <Clock seconds={measures.duration} /> }];
  } else if (exercise.tracking === "distance_duration") {
    columns = [
      { head: "Distance", className: styles.cValue, cell: ({ measures }) => measures.distance === null ? null : formatDistance(measures.distance) },
      { head: "Time", className: styles.cReps, cell: ({ measures }) => measures.duration === null ? null : <Clock seconds={measures.duration} /> },
    ];
  } else if (exercise.tracking === "bodyweight_reps") {
    const weighted = sets.some((set) => (set.measures.load ?? 0) > 0);
    columns = [
      weighted
        ? { head: "Added kg", className: styles.cValue, cell: ({ measures }) => (measures.load ?? 0) > 0 ? <>+<Num value={measures.load!} /></> : <span className="light">BW</span> }
        : { head: null, className: styles.cValue, cell: () => null },
      reps((set) => weighted && set.measures.reps !== null), rpe,
    ];
  } else {
    columns = [
      { head: "kg", className: styles.cValue, cell: ({ measures }) => measures.load === null ? null : <Num value={measures.load} /> },
      reps((set) => set.measures.load !== null), rpe,
    ];
    if (barbell) columns.push(bar);
  }
  const filler = slots - 1 - columns.length;

  const label = (set: PublicSet) => noted.flatMap((field) => {
    const value = set.custom[field.id];
    if (value === undefined || value === "") return [];
    return [{ field, value }];
  });

  return (
    <table className={`table ${styles.sets} ${noted.length ? styles.withNotes : ""}`}>
      <caption className="sr">{exercise.name}</caption>
      <colgroup>
        <col className={styles.cSet} />
        <col className={styles.cValue} />
        <col className={styles.cReps} />
        <col className={styles.cRpe} />
        <col className={styles.cBar} />
        {noted.length > 0 && <col className={styles.notesCol} />}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Set</th>
          {columns.map((column, index) => (
            column.head === null ? <td key={index} className={styles.fillHead} /> : <th key={index} scope="col" className={column.className}>{column.head}</th>
          ))}
          {filler > 0 && <td colSpan={filler} className={styles.fillHead} />}
          {noted.length > 0 && <th scope="col" className={`${styles.notes} ${styles.notesCol}`}>Notes</th>}
        </tr>
      </thead>
      <tbody>
        {sets.map((set) => {
          const pairs = label(set);
          const bare = pairs.length > 0 && !hasValue(set.measures);
          const text = pairs.map(({ field, value }, index) => (
            <span key={field.id} className={styles.note}>
              {index > 0 && ", "}
              <span className="soft">{field.label}</span>{" "}
              <b>{typeof value === "number" ? formatNumber(value) : value}</b>
              {field.unit && <span className="unit"> {field.unit}</span>}
            </span>
          ));
          return (
            <Fragment key={set.id}>
              <tr className={set.warmup ? styles.warmRow : undefined}>
                <th scope="row" className={styles.setNo}>
                  {set.warmup ? <><span aria-hidden="true">W</span><span className="sr">Warm-up</span></> : numbers.get(set.id)}
                </th>
                {bare
                  ? <td colSpan={slots - 1} className={styles.bareNote}>{text}</td>
                  : <>
                    {columns.map((column, index) => <td key={index} className={column.className}>{column.cell(set)}</td>)}
                    {filler > 0 && <td colSpan={filler} />}
                  </>}
                {noted.length > 0 && <td className={`${styles.notes} ${styles.notesCol}`}>{bare ? null : text}</td>}
              </tr>
              {pairs.length > 0 && !bare && (
                <tr className={styles.noteRow}><td colSpan={slots}>{text}</td></tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
