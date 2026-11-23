"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { deleteFieldAction, saveFieldAction } from "@/src/actions/training";
import { Icon } from "@/app/ui/icons";
import { Sheet } from "@/app/ui/sheet";
import type { FieldInfo, FieldKind } from "@/src/lib/workout-doc";
import styles from "../../owner.module.css";

const kinds: Record<FieldKind, string> = { decimal: "Decimal number", integer: "Whole number", text: "Text" };

const offline = "Could not reach the server. Your changes are still here. Check the connection and try again.";

type Target = { field: FieldInfo | null; key: number; open: boolean };

export function FieldList({ fields, exercises }: { fields: FieldInfo[]; exercises: { id: string; name: string }[] }) {
  const [sheet, setSheet] = useState<Target>({ field: null, key: 0, open: false });
  const edit = (field: FieldInfo | null) => setSheet((last) => ({ field, key: last.key + 1, open: true }));
  const nameOf = (id: string | null) => (id === null ? "All exercises" : exercises.find((exercise) => exercise.id === id)?.name ?? "An archived exercise");

  return (
    <div>
      <p className="empty-line">An extra thing to record on a set, such as bar speed. Choose one exercise or all of them.</p>
      {fields.length > 0 && (
        <table className={`table ${styles.stackTop} ${styles.fields}`}>
          <caption className="sr">Extra set fields</caption>
          <thead><tr><th scope="col">Label</th><th scope="col" className={styles.fieldWide}>Unit</th><th scope="col" className={styles.fieldWide}>Type</th><th scope="col">Applies to</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.id}>
                <th scope="row">{field.label}<small className={styles.fieldPhone}>{[kinds[field.kind], field.unit].filter(Boolean).join(", ")}</small></th>
                <td className={styles.fieldWide}>{field.unit || <span className="light">None</span>}</td>
                <td className={styles.fieldWide}>{kinds[field.kind]}</td>
                <td>{nameOf(field.exerciseId)}</td>
                <td className="r">
                  <button type="button" className="btn btn--quiet" onClick={() => edit(field)}>Edit<span className="sr"> {field.label}</span></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.after}>
        <button type="button" className="btn btn--plain" onClick={() => edit(null)}><Icon name="plus" small />Add field</button>
      </div>
      {sheet.key > 0 && <FieldSheet key={sheet.key} field={sheet.field} open={sheet.open} exercises={exercises} onClose={() => setSheet((last) => ({ ...last, open: false }))} />}
    </div>
  );
}

function FieldSheet({ field, open, exercises, onClose }: {
  field: FieldInfo | null; open: boolean; exercises: { id: string; name: string }[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formId = useId();
  const done = () => { onClose(); router.refresh(); };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setMessage(null);
    start(async () => {
      try {
        const result = await saveFieldAction({
          id: field?.id, label: text("label"), unit: text("unit"), kind: text("kind") as FieldKind, exerciseId: text("exercise") || null,
        });
        if (result.ok) done(); else setMessage(result.message);
      } catch {
        setMessage(offline);
      }
    });
  };

  const remove = () => {
    if (!field) return;
    start(async () => {
      try {
        const result = await deleteFieldAction(field.id);
        if (result.ok) done(); else { setConfirming(false); setMessage(result.message); }
      } catch {
        setConfirming(false);
        setMessage(offline);
      }
    });
  };

  const footer = confirming && field ? (
    <>
      <p className={styles.confirmText}>Delete the field {field.label}? This cannot be undone.</p>
      <button type="button" className="btn btn--danger" disabled={pending} onClick={remove}>{pending ? "Deleting" : "Delete field"}</button>
      <button type="button" className="btn btn--plain" disabled={pending} onClick={() => setConfirming(false)}>Keep field</button>
    </>
  ) : (
    <>
      <button type="submit" form={formId} className="btn" disabled={pending}>{pending ? "Saving" : "Save field"}</button>
      {field && <button type="button" className={`btn btn--quiet ${styles.dangerQuiet} ${styles.pushEnd}`} disabled={pending} onClick={() => { setMessage(null); setConfirming(true); }}>Delete</button>}
    </>
  );

  return (
    <Sheet open={open} title={field ? "Edit field" : "Add field"} onClose={onClose} footer={footer}>
      <form id={formId} className={styles.sheetForm} onSubmit={save}>
        {message && <p className="notice notice--alert" role="alert">{message}</p>}
        <div>
          <label className="label" htmlFor={`${formId}-label`}>Label</label>
          <input id={`${formId}-label`} className="field" name="label" defaultValue={field?.label} maxLength={60} required autoComplete="off" />
        </div>
        <div className="form-pair">
          <div>
            <label className="label" htmlFor={`${formId}-unit`}>Unit <span className="hint">optional</span></label>
            <input id={`${formId}-unit`} className="field" name="unit" defaultValue={field?.unit} maxLength={20} placeholder="m/s" autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor={`${formId}-kind`}>Type</label>
            <select id={`${formId}-kind`} className="select" name="kind" defaultValue={field?.kind ?? "decimal"}>
              {(Object.keys(kinds) as FieldKind[]).map((kind) => <option key={kind} value={kind}>{kinds[kind]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`${formId}-exercise`}>Applies to</label>
          <select id={`${formId}-exercise`} className="select" name="exercise" defaultValue={field?.exerciseId ?? ""}>
            <option value="">All exercises</option>
            {exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
            {field?.exerciseId && !exercises.some(({ id }) => id === field.exerciseId) && <option value={field.exerciseId}>An archived exercise</option>}
          </select>
        </div>
      </form>
    </Sheet>
  );
}
