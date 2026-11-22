"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { importBlockAction, importSheetAction } from "@/src/actions/training";
import { dayLabel, weekRange } from "@/src/lib/day-format";
import {
  guessExercise, planBlock, readSheet, rowLabel, sessionName, sheetKey, sheetLimits, suggestStart, suggestTitle, type SheetWorkout,
} from "@/src/lib/sheet-import";
import { addDays, isDay, limits, trackingLabels, type Tracking } from "@/src/lib/workout-doc";
import type { ImportedTemplate } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";

type Pick = { on: boolean; title: string };
type Done = { templates: ImportedTemplate[]; newExercises: string[] };
type Mode = "templates" | "block";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const offline = "Could not reach the server. Your pasted rows are still here. Check the connection and try again.";

export function SheetImport({ known, startAs, today }: {
  known: Array<{ name: string; tracking: Tracking }>;
  startAs: Mode;
  today: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(startAs);
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [blockTitle, setBlockTitle] = useState("");
  const [start, setStart] = useState(today);
  const [startTouched, setStartTouched] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const id = useId();

  const library = useMemo(() => new Map(known.map((exercise) => [sheetKey(exercise.name), exercise.tracking])), [known]);
  const { workouts, found } = useMemo(() => readSheet(text), [text]);
  useEffect(() => {
    setPicks(workouts.map((workout) => ({ on: true, title: suggestTitle(workout) })));
    setMessage(null);
  }, [workouts]);
  // Until the owner picks a day, week 1 starts on the weekday the sheet's own weeks start on.
  useEffect(() => {
    if (!startTouched) setStart(suggestStart(workouts, today));
  }, [workouts, today, startTouched]);

  const chosen = workouts.flatMap((workout, index) => (picks[index]?.on ? [{ workout, index, title: picks[index].title.trim() }] : []));
  const used = mode === "block" ? workouts : chosen.map(({ workout }) => workout);
  const unknown = new Set(used.flatMap((workout) => workout.entries.map((entry) => sheetKey(entry.name)).filter((key) => !library.has(key))));
  const unnamed = chosen.some(({ title }) => !title);
  const validStart = isDay(start);
  const first = validStart ? start : today;
  const plan = useMemo(() => planBlock(workouts, first, newestFirst), [workouts, first, newestFirst]);
  const sessions = plan.reduce((count, week) => count + week.sessions.length, 0);
  // Never drop rows in silence: say what the sheet holds beyond what one import reads.
  const unread = found - workouts.length;
  const unplanned = workouts.length - sessions;
  const change = (index: number, patch: Partial<Pick>) =>
    setPicks((current) => current.map((pick, at) => (at === index ? { ...pick, ...patch } : pick)));

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch {
      setMessage(offline);
    }
    setBusy(false);
  };
  const createTemplates = () => run(async () => {
    const result = await importSheetAction(text, chosen.map(({ index, title }) => ({ index, title })));
    if (result.ok) {
      setDone({ templates: result.templates, newExercises: result.newExercises });
      setText("");
    } else setMessage(result.message);
  });
  const createBlock = () => run(async () => {
    const result = await importBlockAction(text, { title: blockTitle, startDay: first, newestFirst });
    if (result.ok) router.push(`/admin/blocks/${result.id}`);
    else setMessage(result.message);
  });

  const lines = (workout: SheetWorkout) => (
    <ul className={styles.sheetLines}>
      {workout.entries.map((entry, at) => {
        const tracking = library.get(sheetKey(entry.name)) ?? guessExercise(entry).tracking;
        return (
          <li key={at}>
            <span className={styles.sheetName}>
              {entry.name}
              {!library.has(sheetKey(entry.name)) && <> <span className="tag" title={`New exercise, read as: ${trackingLabels[tracking]}`}>New</span></>}
            </span>
            <span className={styles.sheetRows}>{entry.rows.map((row) => rowLabel(row, tracking)).join("; ")}</span>
            {entry.notes.length > 0 && <span className={styles.sheetNote}>{entry.notes.join(". ")}</span>}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {done && (
        <div className="row row--stack">
          <h2 className="row-margin">Created</h2>
          <div>
            <p className="notice" role="status">
              Created {plural(done.templates.length, "template", "templates")}
              {done.newExercises.length > 0 && <> and added {plural(done.newExercises.length, "exercise", "exercises")} to the library</>}.
            </p>
            <ul className={styles.list}>
              {done.templates.map((template) => (
                <li key={template.id} className={styles.item}>
                  <div className={styles.main}>
                    <span className={styles.title}><Link href={`/admin/workouts/${template.id}`}>{template.title}</Link></span>
                    <span className={styles.names}>{plural(template.exercises, "exercise", "exercises")}, {plural(template.sets, "set", "sets")}</span>
                  </div>
                </li>
              ))}
            </ul>
            {done.newExercises.length > 0 && (
              <p className={styles.sheetHint}>
                New in the library: {done.newExercises.join(", ")}. What each one records and its equipment were read from the name;
                correct them under <Link href="/admin/exercises">Exercises</Link>.
              </p>
            )}
            <p className={styles.after}><Link className="btn" href="/admin/templates">Go to templates</Link></p>
          </div>
        </div>
      )}

      <div className="row row--stack">
        <h2 className="row-margin">Paste</h2>
        <div>
          <label className="label" htmlFor={`${id}-paste`}>Rows from your spreadsheet</label>
          <textarea
            id={`${id}-paste`} className={`textarea ${styles.paste}`} wrap="off" spellCheck={false} autoComplete="off"
            rows={8} maxLength={200000} value={text} onChange={(event) => { setText(event.target.value); setDone(null); }}
            placeholder={"Bench press\t3\t5\t100\nPull-ups\t3\t8\tbw+10kg\nSide plank\t2\t60s\teach side"}
          />
          <p className={styles.sheetHint}>
            Understood: sets as 3 or 1+2, reps as 5 or 6-8, time as 60s or 1:30, loads as 100 or 25kg, bw and bw+5kg, RPE9.
            Anything else on a row is kept as a note on the exercise.
          </p>
          <fieldset className={styles.modePick}>
            <legend className="label">Make</legend>
            <div className="segments">
              <label><input type="radio" name={`${id}-mode`} checked={mode === "templates"} onChange={() => setMode("templates")} /><span>Templates</span></label>
              <label><input type="radio" name={`${id}-mode`} checked={mode === "block"} onChange={() => setMode("block")} /><span>One training block</span></label>
            </div>
          </fieldset>
        </div>
      </div>

      {text.trim() !== "" && workouts.length === 0 && (
        <div className="row row--stack">
          <div className="row-margin" />
          <p className="notice notice--alert" role="alert">No workouts found in that text. Each row needs an exercise name in its first cell.</p>
        </div>
      )}

      {unread > 0 && (
        <div className="row row--stack">
          <div className="row-margin" />
          <p className="notice" role="status">
            The sheet holds {found} workouts. One import reads the first {sheetLimits.workouts}; paste the other {unread} on their own afterwards.
          </p>
        </div>
      )}

      {mode === "templates" && workouts.map((workout, index) => {
        const pick = picks[index];
        if (!pick) return null;
        return (
          <div className="row row--stack" key={index}>
            <div className="row-margin">
              <label className="check">
                <input type="checkbox" checked={pick.on} onChange={(event) => change(index, { on: event.target.checked })} />
                <span>Workout {index + 1}</span>
              </label>
              {workout.day && <small>{dayLabel(workout.day)}</small>}
            </div>
            <div className={pick.on ? undefined : styles.sheetOff}>
              <label className="label" htmlFor={`${id}-t${index}`}>Template name</label>
              <input
                id={`${id}-t${index}`} className="field" value={pick.title} maxLength={limits.title} disabled={!pick.on} autoComplete="off"
                aria-invalid={pick.on && !pick.title.trim() ? true : undefined}
                onChange={(event) => change(index, { title: event.target.value })}
              />
              {lines(workout)}
            </div>
          </div>
        );
      })}

      {mode === "block" && workouts.length > 0 && (
        <>
          <div className="row row--stack">
            <h2 className="row-margin">Block</h2>
            <div className="form">
              <div>
                <label className="label" htmlFor={`${id}-name`}>Name</label>
                <input id={`${id}-name`} className="field" value={blockTitle} maxLength={limits.title} autoComplete="off" onChange={(event) => setBlockTitle(event.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor={`${id}-start`}>First day of week 1</label>
                <input
                  id={`${id}-start`} className="field" type="date" value={start} aria-invalid={validStart ? undefined : true}
                  onChange={(event) => { setStart(event.target.value); setStartTouched(true); }}
                />
              </div>
              <label className="check">
                <input type="checkbox" checked={newestFirst} onChange={(event) => setNewestFirst(event.target.checked)} />
                <span>The newest week is at the top of my sheet</span>
              </label>
            </div>
          </div>
          {plan.map(({ week, sessions: planned }) => (
            <div className="row row--stack" key={week}>
              <div className="row-margin">Week {week}<small>{weekRange(addDays(first, 7 * (week - 1)))}</small></div>
              <ul className={styles.weekGrid}>
                {planned.map(({ index, day }) => (
                  <li key={index} className={styles.sessionCell}>
                    <p className={styles.cellDay}>{dayLabel(day)}</p>
                    <p className={styles.title}>{sessionName(workouts[index])}</p>
                    {lines(workouts[index])}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {workouts.length > 0 && (
        <div className="row row--section row--stack">
          <h2 className="row-margin">Create</h2>
          <div>
            <p className={styles.lede}>
              {mode === "block"
                ? <>{plural(plan.length, "week", "weeks")} with {plural(sessions, "session", "sessions")} will be planned from {dayLabel(first)}</>
                : <>{plural(chosen.length, "template", "templates")} will be created</>}
              {unknown.size > 0 && <>, and {plural(unknown.size, "new exercise", "new exercises")} added to the library</>}.
              {mode === "block" ? " Dates in the sheet only decide how the sessions are spread over the week." : " Nothing is changed in templates you already have."}
            </p>
            {mode === "block" && unplanned > 0 && (
              <p className="notice" role="status">
                {plural(unplanned, "workout", "workouts")} of the sheet {unplanned === 1 ? "is" : "are"} left out: a block holds at most {sheetLimits.weeks} weeks of {sheetLimits.sessionsPerWeek} sessions.
              </p>
            )}
            {message && <p className="notice notice--alert" role="alert">{message}</p>}
            <p className={styles.after}>
              {mode === "block" ? (
                <button type="button" className="btn" disabled={busy || !blockTitle.trim() || !validStart} onClick={createBlock}>
                  {busy ? "Creating" : "Create block"}
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy || chosen.length === 0 || unnamed} onClick={createTemplates}>
                  {busy ? "Creating" : `Create ${plural(chosen.length, "template", "templates")}`}
                </button>
              )}
              {mode === "templates" && unnamed && <span className="soft small">Give every chosen workout a name.</span>}
              {mode === "block" && !blockTitle.trim() && <span className="soft small">Give the block a name.</span>}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
