"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { quickAddExerciseAction } from "@/src/actions/training";
import { Icon } from "@/app/ui/icons";
import { Sheet } from "@/app/ui/sheet";
import {
  EQUIPMENT, TRACKINGS, USUAL_MUSCLES, equipmentLabels, exerciseMatches, exerciseMeta, trackingLabels,
  type Equipment, type ExerciseInfo, type Tracking,
} from "@/src/lib/workout-doc";
import type { ExerciseHistory } from "@/src/lib/workout-edit";
import styles from "./session.module.css";

export function ExercisePicker({ open, title, onClose, exercises, histories, onChoose, onCreated }: {
  open: boolean;
  title: string;
  onClose: () => void;
  exercises: ExerciseInfo[];
  histories: Record<string, ExerciseHistory>;
  onChoose: (exercise: ExerciseInfo) => Promise<void>;
  onCreated: (exercise: ExerciseInfo) => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <PickerBody exercises={exercises} histories={histories} onChoose={onChoose} onCreated={onCreated} />
    </Sheet>
  );
}

function PickerBody({ exercises, histories, onChoose, onCreated }: {
  exercises: ExerciseInfo[];
  histories: Record<string, ExerciseHistory>;
  onChoose: (exercise: ExerciseInfo) => Promise<void>;
  onCreated: (exercise: ExerciseInfo) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    // The dialog is not open yet while this first runs, and a closed dialog cannot take focus.
    const timer = setTimeout(() => search.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const typed = query.trim();
  const matches = useMemo(() => {
    const needle = typed.toLowerCase();
    // A hit in the name comes before a hit in the muscle or equipment.
    const rank = (exercise: ExerciseInfo) => (needle && exercise.name.toLowerCase().includes(needle) ? 0 : 1);
    return exercises
      .filter((exercise) => !exercise.archived && exerciseMatches(exercise, typed))
      .sort((a, b) => rank(a) - rank(b) || (histories[b.id]?.day ?? "").localeCompare(histories[a.id]?.day ?? "") ||
        a.name.localeCompare(b.name));
  }, [exercises, histories, typed]);
  const exact = exercises.some((exercise) => exercise.name.toLowerCase() === typed.toLowerCase());

  const choose = async (exercise: ExerciseInfo) => {
    setAdding(exercise.id);
    await onChoose(exercise);
  };

  return (
    <>
      <div className={styles.pickerSearch}>
        <label className="sr" htmlFor="pick-search">Search exercises</label>
        <div className={styles.searchBox}>
          <input
            id="pick-search" ref={search} className="field" type="text" inputMode="search" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
            placeholder="Search by name, muscle or equipment" value={query}
            onChange={(event) => { setQuery(event.target.value); setCreating(false); }}
          />
          {query && (
            <button
              type="button" className={`icon-btn ${styles.clear}`} aria-label="Clear search"
              onClick={() => { setQuery(""); setCreating(false); search.current?.focus(); }}
            >
              <Icon name="close" small />
            </button>
          )}
        </div>
      </div>
      <ul className={styles.pickList}>
        {matches.map((exercise) => (
          <li key={exercise.id}>
            <button type="button" className={styles.pick} disabled={adding !== null} onClick={() => choose(exercise)}>
              <b>{exercise.name}</b>
              <span>{adding === exercise.id ? "Adding" : exerciseMeta(exercise)}</span>
            </button>
          </li>
        ))}
        {typed && !exact && !creating && (
          <li>
            <button type="button" className={styles.pick} onClick={() => setCreating(true)}>
              <b>Create {typed}</b>
              <span>A new exercise in your library</span>
            </button>
          </li>
        )}
      </ul>
      {creating && (
        <CreateForm
          name={typed}
          onCreated={async (exercise) => { onCreated(exercise); await choose(exercise); }}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  );
}

function CreateForm({ name, onCreated, onCancel }: { name: string; onCreated: (exercise: ExerciseInfo) => Promise<void>; onCancel: () => void }) {
  const [tracking, setTracking] = useState<Tracking>("weight_reps");
  const [equipment, setEquipment] = useState<Equipment>("barbell");
  const [muscle, setMuscle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!muscle.trim()) return setError("Enter the primary muscle.");
    setBusy(true);
    setError(null);
    try {
      const result = await quickAddExerciseAction({ name, tracking, equipment, primaryMuscle: muscle.trim() });
      if (!result.ok) {
        setError(result.message);
        setBusy(false);
        return;
      }
      await onCreated(result.exercise);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
      setBusy(false);
    }
  };

  return (
    <form className={styles.createForm} onSubmit={submit}>
      <h3 className={styles.createTitle}>New exercise: {name}</h3>
      {error && <p className="notice notice--alert" role="alert">{error}</p>}
      <fieldset>
        <legend className="label">What a set records</legend>
        <div className={`segments ${styles.trackingChoice}`}>
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
          <label className="label" htmlFor="c-equipment">Equipment</label>
          <select id="c-equipment" className="select" value={equipment} onChange={(event) => setEquipment(event.target.value as Equipment)}>
            {EQUIPMENT.map((value) => <option key={value} value={value}>{equipmentLabels[value]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="c-muscle">Primary muscle</label>
          <input id="c-muscle" className="field" list="usual-muscles" autoComplete="off" value={muscle} maxLength={50} onChange={(event) => setMuscle(event.target.value)} />
          <datalist id="usual-muscles">{USUAL_MUSCLES.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
      </div>
      <div className={styles.sheetActions}>
        <button type="submit" className="btn" disabled={busy}>{busy ? "Creating" : "Create exercise"}</button>
        <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
