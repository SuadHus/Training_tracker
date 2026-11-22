"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import {
  archiveExerciseAction, deleteExerciseAction, saveExerciseAction,
} from "@/src/actions/training";
import { Icon } from "@/app/ui/icons";
import { Notation } from "@/app/ui/notation";
import { Sheet } from "@/app/ui/sheet";
import { SubmitButton } from "@/app/ui/submit-button";
import { dateLabel } from "@/src/lib/day-format";
import {
  EQUIPMENT, TRACKINGS, USUAL_MUSCLES, equipmentLabels, exerciseMatches, exerciseMeta, trackingLabels, stockholmDay,
  type Equipment, type Tracking,
} from "@/src/lib/workout-doc";
import type { ExerciseUsage } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";
import { addStarterExercisesAction } from "./actions";

const STARTER_BELOW = 8;
const offline = "Could not reach the server. Your changes are still here. Check the connection and try again.";
const thisYear = stockholmDay().slice(0, 4);

export function ExerciseLibrary({ exercises }: { exercises: ExerciseUsage[] }) {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [sheet, setSheet] = useState<{ exercise: ExerciseUsage | null; key: number; open: boolean }>({ exercise: null, key: 0, open: false });
  const edit = (exercise: ExerciseUsage | null) => setSheet((last) => ({ exercise, key: last.key + 1, open: true }));
  const searchId = useId();

  const active = exercises.filter((exercise) => !exercise.archived).length;
  const shown = useMemo(() => {
    return exercises.filter((exercise) => (archived || !exercise.archived) && exerciseMatches(exercise, search));
  }, [exercises, search, archived]);

  return (
    <>
      {active < STARTER_BELOW && (
        <div className={styles.starter}>
          <p>{active === 0 ? "The library is empty." : `The library has ${active} ${active === 1 ? "exercise" : "exercises"}.`} Add the usual lifts and edit them later.</p>
          <form action={addStarterExercisesAction}><SubmitButton className="btn btn--plain" pending="Adding">Add the common lifts</SubmitButton></form>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <label className="sr" htmlFor={searchId}>Search exercises</label>
          <input id={searchId} className="field" type="search" placeholder="Search name, muscle, equipment" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" />
        </div>
        <label className="check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Show archived</label>
        <button type="button" className={`btn ${styles.add}`} onClick={() => edit(null)}><Icon name="plus" small />Add exercise</button>
      </div>

      {shown.length > 0 ? (
        <table className={`table ${styles.library}`}>
          <caption className="sr">Exercises</caption>
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">Equipment</th><th scope="col">Records</th><th scope="col">Muscle</th>
              <th scope="col" className="r">Sessions</th><th scope="col">Last</th><th scope="col">Best, est. 1RM</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((exercise) => (
              <tr key={exercise.id} className={exercise.archived ? styles.archived : undefined}>
                <th scope="row">
                  <button type="button" className={styles.nameButton} onClick={() => edit(exercise)}>{exercise.name}</button>
                  {exercise.archived && <> <span className="tag">Archived</span></>}
                  <span className={styles.phoneLine}>
                    {[exerciseMeta(exercise), `${exercise.sessions} ${exercise.sessions === 1 ? "session" : "sessions"}`, exercise.lastDay ? `last ${dateLabel(exercise.lastDay, thisYear)}` : null].filter(Boolean).join(", ")}
                  </span>
                  {exercise.best && (
                    <span className={styles.phoneBest}>
                      <b className="num">{Math.round(exercise.best.estimate)} kg est. 1RM</b>
                      <Notation measures={{ reps: exercise.best.reps, load: exercise.best.load, rpe: null, duration: null, distance: null }} tracking={exercise.tracking} />
                    </span>
                  )}
                </th>
                <td>{equipmentLabels[exercise.equipment]}</td>
                <td>{trackingLabels[exercise.tracking]}</td>
                <td>{exercise.primaryMuscle}</td>
                <td className="r num">{exercise.sessions}</td>
                <td className="nowrap">{exercise.lastDay ? dateLabel(exercise.lastDay, thisYear) : <span className="light">None</span>}</td>
                <td className={styles.best}>
                  {exercise.best ? <>
                    <b className="num">{Math.round(exercise.best.estimate)} kg</b>
                    <Notation measures={{ reps: exercise.best.reps, load: exercise.best.load, rpe: null, duration: null, distance: null }} tracking={exercise.tracking} />
                  </> : <span className="light">None</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-line">{exercises.length === 0 ? "No exercises yet. Add one, or add the common lifts." : "No exercise matches. Clear the search or show archived exercises."}</p>
      )}

      {sheet.key > 0 && <ExerciseSheet key={sheet.key} exercise={sheet.exercise} open={sheet.open} onClose={() => setSheet((last) => ({ ...last, open: false }))} />}
    </>
  );
}

function ExerciseSheet({ exercise, open, onClose }: { exercise: ExerciseUsage | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [equipment, setEquipment] = useState<Equipment>(exercise?.equipment ?? "barbell");
  const [tracking, setTracking] = useState<Tracking>(exercise?.tracking ?? "weight_reps");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formId = useId();

  const done = () => { onClose(); router.refresh(); };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const number = (name: string) => (text(name) === "" ? null : Number(text(name)));
    setMessage(null);
    start(async () => {
      try {
        const result = await saveExerciseAction({
        id: exercise?.id,
        name: text("name"),
        tracking,
        equipment,
        barKg: equipment === "barbell" ? number("barKg") : null,
        restSeconds: number("restSeconds"),
        primaryMuscle: text("primaryMuscle"),
        secondaryMuscles: text("secondaryMuscles").split(",").map((muscle) => muscle.trim()).filter(Boolean),
        notes: text("notes"),
        });
        if (result.ok) done(); else setMessage(result.message);
      } catch {
        setMessage(offline);
      }
    });
  };

  const archive = (archived: boolean) => {
    if (!exercise) return;
    setMessage(null);
    start(async () => {
      try {
        const result = await archiveExerciseAction(exercise.id, archived);
        if (result.ok) done(); else setMessage(result.message);
      } catch {
        setMessage(offline);
      }
    });
  };

  const remove = () => {
    if (!exercise) return;
    setMessage(null);
    start(async () => {
      try {
        const result = await deleteExerciseAction(exercise.id);
        if (!result.ok) { setConfirming(false); setMessage(result.message); }
        else if (result.result === "in_use") { setConfirming(false); setMessage("This exercise is used in workouts or templates. Archive it instead."); }
        else done();
      } catch {
        setConfirming(false);
        setMessage(offline);
      }
    });
  };

  const footer = confirming && exercise ? (
    <>
      <p className={styles.confirmText}>Delete {exercise.name} for good? This cannot be undone.</p>
      <button type="button" className="btn btn--danger" disabled={pending} onClick={remove}>{pending ? "Deleting" : "Delete exercise"}</button>
      <button type="button" className="btn btn--plain" disabled={pending} onClick={() => setConfirming(false)}>Keep exercise</button>
    </>
  ) : (
    <>
      <button type="submit" form={formId} className="btn" disabled={pending}>{pending ? "Saving" : "Save exercise"}</button>
      {exercise && <button type="button" className="btn btn--plain" disabled={pending} onClick={() => archive(!exercise.archived)}>{exercise.archived ? "Restore" : "Archive"}</button>}
      {exercise && <button type="button" className={`btn btn--quiet ${styles.dangerQuiet} ${styles.pushEnd}`} disabled={pending} onClick={() => { setMessage(null); setConfirming(true); }}>Delete</button>}
    </>
  );

  return (
    <Sheet open={open} title={exercise ? "Edit exercise" : "Add exercise"} onClose={onClose} footer={footer}>
      <form id={formId} className={styles.sheetForm} onSubmit={save}>
        {message && <p className="notice notice--alert" role="alert">{message}</p>}
        <div>
          <label className="label" htmlFor={`${formId}-name`}>Name</label>
          <input id={`${formId}-name`} className="field" name="name" defaultValue={exercise?.name} maxLength={100} required autoComplete="off" />
        </div>
        <fieldset>
          <legend>A set records</legend>
          <div className={`segments ${styles.tracking}`}>
            {TRACKINGS.map((value) => (
              <label key={value}>
                <input type="radio" name="tracking" value={value} checked={tracking === value} onChange={() => setTracking(value)} />
                <span>{trackingLabels[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-pair">
          <div>
            <label className="label" htmlFor={`${formId}-equipment`}>Equipment</label>
            <select id={`${formId}-equipment`} className="select" value={equipment} onChange={(event) => setEquipment(event.target.value as Equipment)}>
              {EQUIPMENT.map((value) => <option key={value} value={value}>{equipmentLabels[value]}</option>)}
            </select>
          </div>
          {equipment === "barbell" && (
            <div>
              <label className="label" htmlFor={`${formId}-bar`}>Bar weight, kg</label>
              <input id={`${formId}-bar`} className="field" name="barKg" inputMode="decimal" placeholder="20" defaultValue={exercise?.barKg ?? ""} />
            </div>
          )}
          <div>
            <label className="label" htmlFor={`${formId}-rest`}>Rest, seconds</label>
            <input id={`${formId}-rest`} className="field" name="restSeconds" inputMode="numeric" placeholder="150" defaultValue={exercise?.restSeconds ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`${formId}-primary`}>Primary muscle</label>
          <input id={`${formId}-primary`} className="field" name="primaryMuscle" list={`${formId}-muscles`} defaultValue={exercise?.primaryMuscle} maxLength={50} required autoComplete="off" />
          <datalist id={`${formId}-muscles`}>{USUAL_MUSCLES.map((muscle) => <option key={muscle} value={muscle} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor={`${formId}-secondary`}>Secondary muscles <span className="hint">comma separated</span></label>
          <input id={`${formId}-secondary`} className="field" name="secondaryMuscles" defaultValue={exercise?.secondaryMuscles.join(", ")} autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor={`${formId}-notes`}>Notes</label>
          <textarea id={`${formId}-notes`} className="textarea" name="notes" defaultValue={exercise?.notes} maxLength={500} />
        </div>
      </form>
    </Sheet>
  );
}
