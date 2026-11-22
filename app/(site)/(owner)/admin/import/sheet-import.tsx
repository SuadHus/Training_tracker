"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { importSheetAction } from "@/src/actions/training";
import { dayLabel } from "@/src/lib/day-format";
import { guessExercise, parseSheet, rowLabel, sheetKey, suggestTitle } from "@/src/lib/sheet-import";
import { limits, trackingLabels, type Tracking } from "@/src/lib/workout-doc";
import type { ImportedTemplate } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";

type Pick = { on: boolean; title: string };
type Done = { templates: ImportedTemplate[]; newExercises: string[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function SheetImport({ known }: { known: Array<{ name: string; tracking: Tracking }> }) {
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const pasteId = useId();

  const library = useMemo(() => new Map(known.map((exercise) => [sheetKey(exercise.name), exercise.tracking])), [known]);
  const workouts = useMemo(() => parseSheet(text), [text]);
  useEffect(() => {
    setPicks(workouts.map((workout) => ({ on: true, title: suggestTitle(workout) })));
    setMessage(null);
  }, [workouts]);

  const chosen = workouts.flatMap((workout, index) => (picks[index]?.on ? [{ workout, index, title: picks[index].title.trim() }] : []));
  const unknown = new Set(chosen.flatMap(({ workout }) => workout.entries.map((entry) => sheetKey(entry.name)).filter((key) => !library.has(key))));
  const unnamed = chosen.some(({ title }) => !title);
  const change = (index: number, patch: Partial<Pick>) =>
    setPicks((current) => current.map((pick, at) => (at === index ? { ...pick, ...patch } : pick)));

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await importSheetAction(text, chosen.map(({ index, title }) => ({ index, title })));
      if (result.ok) {
        setDone({ templates: result.templates, newExercises: result.newExercises });
        setText("");
      } else setMessage(result.message);
    } catch {
      setMessage("Could not reach the server. Your pasted rows are still here. Check the connection and try again.");
    }
    setBusy(false);
  };

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
          <label className="label" htmlFor={pasteId}>Rows from your spreadsheet</label>
          <textarea
            id={pasteId} className={`textarea ${styles.paste}`} wrap="off" spellCheck={false} autoComplete="off"
            rows={8} maxLength={200000} value={text} onChange={(event) => { setText(event.target.value); setDone(null); }}
            placeholder={"Bench press\t3\t5\t100\nPull-ups\t3\t8\tbw+10kg\nSide plank\t2\t60s\teach side"}
          />
          <p className={styles.sheetHint}>
            Understood: sets as 3 or 1+2, reps as 5 or 6-8, time as 60s or 1:30, loads as 100 or 25kg, bw and bw+5kg, RPE9.
            Anything else on a row is kept as a note on the exercise.
          </p>
        </div>
      </div>

      {text.trim() !== "" && workouts.length === 0 && (
        <div className="row row--stack">
          <div className="row-margin" />
          <p className="notice notice--alert" role="alert">No workouts found in that text. Each row needs an exercise name in its first cell.</p>
        </div>
      )}

      {workouts.map((workout, index) => {
        const pick = picks[index];
        if (!pick) return null;
        const titleId = `${pasteId}-t${index}`;
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
              <label className="label" htmlFor={titleId}>Template name</label>
              <input
                id={titleId} className="field" value={pick.title} maxLength={limits.title} disabled={!pick.on} autoComplete="off"
                aria-invalid={pick.on && !pick.title.trim() ? true : undefined}
                onChange={(event) => change(index, { title: event.target.value })}
              />
              <ul className={styles.sheetLines}>
                {workout.entries.map((entry, at) => {
                  const tracking = library.get(sheetKey(entry.name)) ?? guessExercise(entry).tracking;
                  const fresh = !library.has(sheetKey(entry.name));
                  return (
                    <li key={at}>
                      <span className={styles.sheetName}>
                        {entry.name}
                        {fresh && <> <span className="tag" title={`New exercise, read as: ${trackingLabels[tracking]}`}>New</span></>}
                      </span>
                      <span className={styles.sheetRows}>{entry.rows.map((row) => rowLabel(row, tracking)).join("; ")}</span>
                      {entry.notes.length > 0 && <span className={styles.sheetNote}>{entry.notes.join(". ")}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}

      {workouts.length > 0 && (
        <div className="row row--section row--stack">
          <h2 className="row-margin">Create</h2>
          <div>
            <p className={styles.lede}>
              {plural(chosen.length, "template", "templates")} will be created
              {unknown.size > 0 && <>, and {plural(unknown.size, "new exercise", "new exercises")} added to the library</>}.
              Nothing is changed in templates you already have.
            </p>
            {message && <p className="notice notice--alert" role="alert">{message}</p>}
            <p className={styles.after}>
              <button type="button" className="btn" disabled={busy || chosen.length === 0 || unnamed} onClick={create}>
                {busy ? "Creating" : `Create ${plural(chosen.length, "template", "templates")}`}
              </button>
              {unnamed && <span className="soft small">Give every chosen workout a name.</span>}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
