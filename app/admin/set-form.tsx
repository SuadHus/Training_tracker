"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CustomValues, FieldDefinition } from "../../src/lib/training-admin";
import { WorkoutSubmit } from "./workout-submit";
import styles from "./workouts/workout.module.css";

export type AdminField = FieldDefinition & { unit: string; exercise_id: string | null };

type Exercise = { id: string; name: string; type: string };

export type SetValues = {
  reps?: number | null;
  load?: string | null;
  rpe?: string | null;
  duration?: string | null;
  distance?: string | null;
  custom?: CustomValues;
};

export type SetPreset = { label: string; values: SetValues };

const metricNames = {
  reps: "reps",
  load: "load_kg",
  rpe: "rpe",
  duration: "duration_seconds",
  distance: "distance_meters",
} as const;

function revealMeasurement(input: HTMLInputElement, form: HTMLFormElement) {
  const section = input.closest("details");
  if (section && form.contains(section)) section.open = true;
}

function revealInvalidMeasurement(event: FormEvent<HTMLFormElement>) {
  if (event.target instanceof HTMLInputElement) revealMeasurement(event.target, event.currentTarget);
}

export function SetFields({ exercise, fields, values = {}, preset }: {
  exercise: Exercise;
  fields: AdminField[];
  values?: SetValues;
  preset?: SetPreset;
}) {
  const marker = useRef<HTMLDivElement>(null);
  const timed = /cardio|run|cycle|endurance|conditioning/i.test(exercise.type) ||
    values.duration != null || values.distance != null || preset?.values.duration != null || preset?.values.distance != null;

  function applyPreset() {
    const form = marker.current?.closest("form");
    if (!preset || !form) return;
    for (const [metric, name] of Object.entries(metricNames)) {
      const value = preset.values[metric as keyof typeof metricNames];
      const input = form.elements.namedItem(name);
      if (value != null && input instanceof HTMLInputElement) {
        input.value = String(value);
        revealMeasurement(input, form);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  const strength = <div className={styles.fields}>
    <label>Load (kg)<input name="load_kg" type="number" inputMode="decimal" min={0} max={100000} step="any" defaultValue={values.load ?? undefined} /></label>
    <label>Reps<input name="reps" type="number" inputMode="numeric" min={1} max={100000} step={1} defaultValue={values.reps ?? undefined} /></label>
    <label>RPE<input name="rpe" type="number" inputMode="decimal" min={1} max={10} step="any" defaultValue={values.rpe ?? undefined} /></label>
  </div>;
  const timeDistance = <div className={styles.fields}>
    <label>Duration (s)<input name="duration_seconds" type="number" inputMode="decimal" min=".01" max={86400} step="any" defaultValue={values.duration ?? undefined} /></label>
    <label>Distance (m)<input name="distance_meters" type="number" inputMode="decimal" min=".01" max={1000000} step="any" defaultValue={values.distance ?? undefined} /></label>
  </div>;

  return (
    <>
      {preset && <div ref={marker} className={styles.actions}>
        <button type="button" onClick={applyPreset} className={styles.textButton}>{preset.label}</button>
      </div>}
      {timed ? timeDistance : strength}
      <details className={styles.extras} open={timed && (values.load != null || values.reps != null || values.rpe != null || preset?.values.reps != null || preset?.values.load != null || preset?.values.rpe != null) || undefined}>
        <summary>{timed ? "Load, reps and RPE" : "Time and distance"}</summary>
        {timed ? strength : timeDistance}
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
                min={field.kind !== "text" ? -1e9 : undefined}
                max={field.kind !== "text" ? 1e9 : undefined}
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

export function NewActualSet({ action, exercises, fields, submissionId, afterSetId, presets, advance }: {
  action: (form: FormData) => Promise<void>;
  exercises: Exercise[];
  fields: AdminField[];
  submissionId: string;
  afterSetId?: string;
  presets?: Record<string, SetPreset>;
  advance?: boolean;
}) {
  const [id, setId] = useState(exercises[0]?.id);
  const exercise = exercises.find((candidate) => candidate.id === id);
  if (!exercise) return null;

  return (
    <form action={action} className={styles.form} onInvalidCapture={revealInvalidMeasurement}>
      <input type="hidden" name="mode" value="actual" />
      <input type="hidden" name="submission_id" value={submissionId} />
      {advance && <input type="hidden" name="advance" value="1" />}
      {afterSetId && <input type="hidden" name="after_set_id" value={afterSetId} />}
      {afterSetId ? <input type="hidden" name="exercise_id" value={id} /> : (
        <label>Exercise
          <select name="exercise_id" value={id} onChange={(event) => setId(event.target.value)} required>
            {exercises.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
      )}
      <SetFields key={id} exercise={exercise} preset={presets?.[id]} fields={fields.filter((field) => !field.exercise_id || field.exercise_id === id)} />
      <div className={styles.actions}>
        <label className={styles.check}><input type="checkbox" name="warmup" /> Warm-up</label>
        <WorkoutSubmit>Log set</WorkoutSubmit>
      </div>
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
      // Earlier versions stored the whole set, including its position.
      const { position: _position, ...savedSet } = JSON.parse(data.version);
      if (JSON.stringify(savedSet) !== version) {
        localStorage.removeItem(key);
        return;
      }
      for (const input of draftInputs(form.current)) {
        const value = data.values[input.name];
        if (input.type === "checkbox" && typeof value === "boolean") input.checked = value;
        if (input.type !== "checkbox" && typeof value === "string") {
          input.value = value;
          if (value) revealMeasurement(input, form.current);
        }
      }
      setDraft(true);
    } catch {
      // The form still works when browser storage is disabled.
    }
  }, [key, version]);

  return (
    <form ref={form} action={action} className={styles.form} onInvalidCapture={revealInvalidMeasurement} onInput={() => {
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
      {draft && <small role="status" className={styles.draft}>Draft saved on this device.</small>}
    </form>
  );
}

export function NextSetLink({ setId, exerciseName }: { setId: string; exerciseName: string }) {
  return <a href={`#set-${setId}`} className={styles.jump} onClick={() => {
    const details = document.getElementById(`set-${setId}`);
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
      details.querySelector("summary")?.focus({ preventScroll: true });
    }
  }}>Next set · {exerciseName} <span aria-hidden="true">↓</span></a>;
}
