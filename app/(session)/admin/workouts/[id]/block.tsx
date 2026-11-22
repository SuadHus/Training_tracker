"use client";

import { useEffect, useRef, useState } from "react";
import { BarLoad, perSide } from "@/app/ui/bar-load";
import { Icon } from "@/app/ui/icons";
import { Notation } from "@/app/ui/notation";
import { dayLabel } from "@/src/lib/day-format";
import {
  STANDARD_BAR_KG, collapseSets, formatNumber, hasResult, isLogged, setNotation,
  type BlockDoc, type ExerciseInfo, type FieldInfo, type SetDoc, type SetTarget,
} from "@/src/lib/workout-doc";
import {
  placeholderFor, previousFor, restFor, type EditAction, type ExerciseHistory, type HistorySet,
} from "@/src/lib/workout-edit";
import { rpeCodec } from "./field-input";
import { MeasureInput } from "./measure-input";
import { Menu, type MenuItem } from "./menu";
import styles from "./session.module.css";
import type { SheetState } from "./sheets";
import { fieldSpecs } from "./specs";

type Mode = "plan" | "log";

const UNDO_GUARD_MS = 600;

type BlockProps = {
  index: number;
  count: number;
  block: BlockDoc;
  exercise: ExerciseInfo | undefined;
  history: ExerciseHistory | undefined;
  mode: Mode;
  nextSetId: string | null;
  fields: FieldInfo[];
  dispatch: (action: EditAction) => void;
  open: (sheet: SheetState) => void;
  onRemoveBlock: (block: BlockDoc) => void;
  onLogged: (seconds: number) => void;
  newId: () => string;
};

export function ExerciseBlock(props: BlockProps) {
  const { index, count, block, exercise, history, mode, nextSetId, dispatch, open } = props;
  const name = exercise?.name ?? "Unknown exercise";
  const tracking = exercise?.tracking ?? "weight_reps";
  const log = mode === "log";
  const specs = fieldSpecs(tracking, !log);
  const headingId = `h-${block.id}`;
  let working = 0;
  let warm = 0;

  const items: MenuItem[] = [
    { label: "Notes", icon: "note", onSelect: () => open({ kind: "notes", blockId: block.id }) },
    { label: "Rest time", icon: "timer", onSelect: () => open({ kind: "rest", blockId: block.id }) },
    { label: "Replace exercise", icon: "swap", onSelect: () => open({ kind: "picker", replace: block.id }) },
    { label: "Add warm-up set", icon: "plus", onSelect: () => dispatch({ type: "addSet", blockId: block.id, setId: props.newId(), warmup: true }) },
    "separator",
    { label: "Move up", icon: "up", disabled: index === 0, onSelect: () => dispatch({ type: "moveBlock", blockId: block.id, to: index - 1 }) },
    { label: "Move down", icon: "down", disabled: index === count - 1, onSelect: () => dispatch({ type: "moveBlock", blockId: block.id, to: index + 1 }) },
    "separator",
    { label: "Remove exercise", icon: "trash", danger: true, onSelect: () => props.onRemoveBlock(block) },
  ];

  return (
    <li className={styles.block}>
      <section id={`b-${block.id}`} aria-labelledby={headingId}>
        <header className={styles.exHead}>
          <span className={styles.exNo} aria-hidden="true">{index + 1}</span>
          <h2 id={headingId} className={styles.exName}>{name}</h2>
          <Menu label={`${name}, exercise options`} items={items} />
          {(log && history || block.notes) && (
            <div className={styles.exInfo}>
              {log && history && <LastTime history={history} tracking={tracking} />}
              {block.notes && <p className={styles.exNotes}>{block.notes}</p>}
            </div>
          )}
        </header>

        {block.sets.length > 0 && (
          <table className={styles.sets}>
            <caption className="sr">{name}, sets</caption>
            <colgroup>
              <col className={styles.colSet} />
              {log && <col className={styles.colPrev} />}
              {specs.map((spec) => <col key={spec.key} />)}
              <col />
              {log && <col className={styles.colDone} />}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Set</th>
                {log && <th scope="col">Previous</th>}
                {specs.map((spec) => <th key={spec.key} scope="col" className={styles.center}>{spec.head}</th>)}
                <th scope="col" className={styles.center}>RPE{!log && <span className="sr"> target</span>}</th>
                {log && <th scope="col" className={styles.center}>Done</th>}
              </tr>
            </thead>
            <tbody>
              {block.sets.map((set, at) => {
                if (set.warmup) warm += 1;
                else working += 1;
                const label = set.warmup ? `Warm-up ${warm}` : `Set ${working}`;
                return (
                  <SetRow
                    key={set.id}
                    {...props}
                    set={set}
                    at={at}
                    label={label}
                    shortLabel={set.warmup ? "W" : String(working)}
                    state={!log ? "plan" : isLogged(set) ? "logged" : set.id === nextSetId ? "next" : "pending"}
                    exerciseName={name}
                    tracking={tracking}
                  />
                );
              })}
            </tbody>
          </table>
        )}
        <button
          type="button"
          className={`btn btn--quiet btn--wide ${styles.addSet}`}
          onClick={() => dispatch({ type: "addSet", blockId: block.id, setId: props.newId() })}
        >
          <Icon name="plus" small />Add set
        </button>
      </section>
    </li>
  );
}

function LastTime({ history, tracking }: { history: ExerciseHistory; tracking: ExerciseInfo["tracking"] }) {
  const runs = collapseSets(history.sets.filter((set) => !set.warmup));
  if (!runs.length) return null;
  const shown = runs.slice(0, 4);
  return (
    <p className={styles.exLast}>
      Last: {dayLabel(history.day)}
      {shown.map((run, at) => (
        <span key={at}>{at === 0 ? ", " : "; "}<Notation measures={{ ...run.measures, rpe: null }} tracking={tracking} count={run.count} /></span>
      ))}
      {runs.length > shown.length && ", and more"}
    </p>
  );
}

type RowProps = BlockProps & {
  set: SetDoc;
  at: number;
  label: string;
  shortLabel: string;
  state: "plan" | "pending" | "next" | "logged";
  exerciseName: string;
  tracking: ExerciseInfo["tracking"];
};

function previousText(previous: HistorySet, tracking: ExerciseInfo["tracking"]) {
  return setNotation({ ...previous.measures, rpe: null }, tracking);
}

function SetRow({ block, set, at, label, shortLabel, state, exercise, tracking, history, fields, dispatch, open, onLogged }: RowProps) {
  const row = useRef<HTMLTableRowElement>(null);
  const [flagged, setFlagged] = useState<string | null>(null);
  const flagTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flagTimer.current), []);

  const log = state !== "plan";
  const logged = state === "logged";
  const specs = fieldSpecs(tracking, !log);
  const placeholder = placeholderFor(block, at, history);
  const previous = log ? previousFor(history, block, at) : null;
  const source = log ? set.actual : set.target;
  const hasExtra = fields.some((field) => field.exerciseId === null || field.exerciseId === block.exerciseId);

  const edit = (patch: Partial<SetTarget>) => {
    setFlagged(null);
    dispatch(log
      ? { type: "editActual", blockId: block.id, setId: set.id, patch }
      : { type: "editTarget", blockId: block.id, setId: set.id, patch });
  };

  const toggleDone = () => {
    if (!log) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    if (logged) {
      // A second tap in quick succession is a double tap, not a wish to undo.
      if (set.loggedAt && Date.now() - Date.parse(set.loggedAt) < UNDO_GUARD_MS) return;
      dispatch({ type: "unlogSet", blockId: block.id, setId: set.id });
      return;
    }
    const unreadable = row.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    if (unreadable) {
      unreadable.focus();
      return;
    }
    const counts = hasResult({
      actual: {
        ...set.actual,
        reps: set.actual.reps ?? placeholder.reps,
        duration: set.actual.duration ?? placeholder.duration,
        distance: set.actual.distance ?? placeholder.distance,
      },
      custom: set.custom,
    });
    if (!counts) {
      const inputs = [...(row.current?.querySelectorAll<HTMLInputElement>("input[data-result]") ?? [])];
      const target = inputs.find((input) => !input.value) ?? inputs[0];
      if (target) {
        target.focus();
        setFlagged(target.getAttribute("aria-label"));
        clearTimeout(flagTimer.current);
        flagTimer.current = setTimeout(() => setFlagged(null), 1500);
      }
      return;
    }
    dispatch({ type: "logSet", blockId: block.id, setId: set.id, at: new Date().toISOString(), fallback: placeholder });
    onLogged(restFor(block, exercise));
  };

  const items: MenuItem[] = [
    {
      label: set.warmup ? "Working set" : "Warm-up set",
      icon: "flag",
      onSelect: () => dispatch({ type: "setWarmup", blockId: block.id, setId: set.id, warmup: !set.warmup }),
    },
    ...(log ? [{ label: "Edit target", icon: "pencil" as const, onSelect: () => open({ kind: "target", blockId: block.id, setId: set.id }) }] : []),
    ...(log && hasExtra ? [{ label: "Extra set fields", icon: "note" as const, onSelect: () => open({ kind: "extra", blockId: block.id, setId: set.id }) }] : []),
    "separator" as const,
    {
      label: "Remove set",
      icon: "trash" as const,
      danger: true,
      onSelect: () => (logged ? open({ kind: "removeSet", blockId: block.id, setId: set.id }) : dispatch({ type: "removeSet", blockId: block.id, setId: set.id })),
    },
  ];

  const barbell = exercise?.equipment === "barbell";
  const callLoad = set.actual.load ?? placeholder.load;

  return (
    <>
      <tr ref={row} className={styles.setRow} data-state={state} aria-current={state === "next" ? "step" : undefined}>
        <th scope="row" className={styles.setCell}>
          <Menu label={`${label} options`} items={items} align="start">
            <span className={styles.setNo}>{shortLabel}</span>
          </Menu>
        </th>
        {log && (
          <td className={styles.prevCell}>
            {previous ? (
              <button
                type="button"
                className={styles.prev}
                disabled={logged}
                aria-label={`Copy previous ${previousText(previous, tracking)}`}
                onClick={() => edit({
                  load: previous.measures.load, reps: previous.measures.reps,
                  duration: previous.measures.duration, distance: previous.measures.distance,
                })}
              >
                <Notation measures={{ ...previous.measures, rpe: null }} tracking={tracking} warmup={previous.warmup} />
              </button>
            ) : (
              <span className={styles.noPrev}><span aria-hidden="true">–</span><span className="sr">No previous set</span></span>
            )}
          </td>
        )}
        {specs.map((spec) => {
          const text = `${label} ${spec.key === "load" ? spec.head : spec.head.toLowerCase()}`;
          return (
            <td key={spec.key} className={styles.inputCell}>
              <MeasureInput
                codec={spec.codec}
                value={spec.read(source as never)}
                label={text}
                placeholder={(log && !logged ? spec.codec.format(spec.read(placeholder as never)) : "") || spec.hint || ""}
                inputMode={spec.inputMode}
                result={log && spec.result}
                flagged={flagged === text}
                onValue={(value) => edit(spec.write(value))}
                onEnter={toggleDone}
              />
            </td>
          );
        })}
        <td className={styles.inputCell}>
          <MeasureInput
            codec={rpeCodec}
            value={source.rpe}
            label={`${label} RPE${log ? "" : " target"}`}
            placeholder="RPE"
            className={`${styles.input} ${styles.rpe}`}
            onValue={(value) => edit({ rpe: value })}
            onEnter={toggleDone}
          />
        </td>
        {log && (
          <td className={styles.doneCell}>
            <button
              type="button"
              className={styles.done}
              aria-pressed={logged}
              aria-label={`${label} done`}
              onClick={toggleDone}
            >
              <Icon name="check" />
            </button>
          </td>
        )}
      </tr>
      {state === "next" && barbell && callLoad !== null && (
        <tr className={styles.callout} data-state="next">
          <td colSpan={specs.length + 4}>
            <Callout load={callLoad} barKg={exercise?.barKg ?? null} />
          </td>
        </tr>
      )}
    </>
  );
}

function Callout({ load, barKg }: { load: number; barKg: number | null }) {
  const plates = perSide(load, barKg);
  const bar = barKg ?? STANDARD_BAR_KG;
  if (plates === null) {
    return <p className={styles.noPlates}>No plate combination for {formatNumber(load)} kg.</p>;
  }
  return (
    <div className={styles.calloutBody}>
      <BarLoad load={load} barKg={barKg} size="tool" />
      <div>
        <p className="per-side">Per side</p>
        <p className={styles.plates}>{plates}</p>
        <p className="per-side">Bar {formatNumber(bar)} kg, total {formatNumber(load)} kg</p>
      </div>
    </div>
  );
}
