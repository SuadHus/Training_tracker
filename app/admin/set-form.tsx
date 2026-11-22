"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CustomValues, FieldDefinition } from "../../src/lib/training-admin";
import styles from "./admin.module.css";

export type AdminField = FieldDefinition & { unit: string; exercise_id: string | null };

type Exercise = { id: string; name: string; type: string };

type SetValues = {
  reps?: number | string | null;
  load?: string | null;
  rpe?: string | null;
  duration?: string | null;
  distance?: string | null;
  custom?: CustomValues;
};

function decimalDefault(value: number | string | null | undefined) {
  return value ?? undefined;
}

export function SetFields({ exercise, fields, values = {} }: {
  exercise: Exercise;
  fields: AdminField[];
  values?: SetValues;
}) {
  return (
    <>
      <div className={styles.fields}>
        <label>Load (kg)<input name="load_kg" type="number" inputMode="decimal" min={0} step="any" defaultValue={decimalDefault(values.load)} /></label>
        <label>Reps<input name="reps" type="number" inputMode="numeric" min={1} step={1} defaultValue={decimalDefault(values.reps)} /></label>
        <label>RPE<input name="rpe" type="number" inputMode="decimal" min={1} max={10} step="any" defaultValue={decimalDefault(values.rpe)} /></label>
      </div>
      <details className={styles.toggle} open={/cardio|run|cycle|endurance/i.test(exercise.type) || values.duration != null || values.distance != null || undefined}>
        <summary>Time and distance</summary>
        <div className={styles.fields}>
          <label>Duration (s)<input name="duration_seconds" type="number" inputMode="decimal" min=".01" step="any" defaultValue={decimalDefault(values.duration)} /></label>
          <label>Distance (m)<input name="distance_meters" type="number" inputMode="decimal" min=".01" step="any" defaultValue={decimalDefault(values.distance)} /></label>
        </div>
      </details>
      {fields.length > 0 && (
        <div className={styles.fields}>
          {fields.map((field) => (
            <label key={field.id}>
              {field.label}{field.unit && ` (${field.unit})`}
              <input
                name={`custom_${field.id}`}
                type={field.kind === "text" ? "text" : "number"}
                inputMode={field.kind === "text" ? "text" : field.kind === "integer" ? "numeric" : "decimal"}
                step={field.kind === "integer" ? 1 : field.kind === "decimal" ? "any" : undefined}
                maxLength={field.kind === "text" ? 500 : undefined}
                defaultValue={values.custom?.[field.id]}
              />
            </label>
          ))}
        </div>
      )}
    </>
  );
}

export function NewActualSet({ action, exercises, fields, submissionId }: {
  action: (form: FormData) => Promise<void>;
  exercises: Exercise[];
  fields: AdminField[];
  submissionId: string;
}) {
  const [id, setId] = useState(exercises[0]?.id);
  const exercise = exercises.find((candidate) => candidate.id === id);
  if (!exercise) return null;

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="mode" value="actual" />
      <input type="hidden" name="submission_id" value={submissionId} />
      <label>Exercise
        <select name="exercise_id" value={id} onChange={(event) => setId(event.target.value)} required>
          {exercises.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <SetFields key={id} exercise={exercise} fields={fields.filter((field) => !field.exercise_id || field.exercise_id === id)} />
      <label className={styles.check}><input type="checkbox" name="warmup" /> Warm-up set</label>
      <div className={styles.actions}><button>Log set</button></div>
    </form>
  );
}

function draftInputs(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (element): element is HTMLInputElement => element instanceof HTMLInputElement && element.type !== "hidden",
  );
}

export function SetDraftForm({ action, setId, version, children }: {
  action: (form: FormData) => Promise<void>;
  setId: string;
  version: string;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(false);
  const key = `training-set-draft:${setId}`;
  useEffect(() => {
    if (!form.current) return;
    try {
      const saved = localStorage.getItem(key);
      if (!saved) return;
      const data = JSON.parse(saved) as { version: string; values: Record<string, string | boolean> };
      if (data.version !== version) {
        localStorage.removeItem(key);
        return;
      }
      for (const input of draftInputs(form.current)) {
        const value = data.values[input.name];
        if (input.type === "checkbox" && typeof value === "boolean") input.checked = value;
        if (input.type !== "checkbox" && typeof value === "string") input.value = value;
      }
      setDraft(true);
    } catch {
      // The form still works when browser storage is disabled.
    }
  }, [key, version]);

  return (
    <form ref={form} action={action} className={styles.form} onChange={() => {
      if (!form.current) return;
      const values = Object.fromEntries(draftInputs(form.current).map((input) => [
        input.name, input.type === "checkbox" ? input.checked : input.value,
      ]));
      try {
        localStorage.setItem(key, JSON.stringify({ version, values }));
        setDraft(true);
      } catch {
        // The form still works when browser storage is disabled.
      }
    }}>
      {children}
      {draft && <small role="status">Draft saved on this device. Log the set to save it to the workout.</small>}
    </form>
  );
}
