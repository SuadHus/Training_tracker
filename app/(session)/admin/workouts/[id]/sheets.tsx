"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  completeWorkoutAction, deleteWorkoutAction, saveAsTemplateAction, startWorkoutAction,
} from "@/src/actions/training";
import { Sheet } from "@/app/ui/sheet";
import { SubmitButton } from "@/app/ui/submit-button";
import {
  DEFAULT_REST_SECONDS, addDays, allSets, formatSpan, formatTotal, isLogged, limits, newId, summarizeSets,
  type BlockDoc, type ExerciseInfo, type FieldInfo, type SetDoc, type WorkoutDoc,
} from "@/src/lib/workout-doc";
import type { EditAction } from "@/src/lib/workout-edit";
import { decimalCodec, integerCodec, parseNumberInput, rpeCodec } from "./field-input";
import { MeasureInput } from "./measure-input";
import styles from "./session.module.css";
import type { SyncStatus } from "./use-workout-sync";
import { fieldSpecs } from "./specs";

export type SheetState =
  | { kind: "details" }
  | { kind: "finish" }
  | { kind: "saveTemplate" }
  | { kind: "planDay" }
  | { kind: "delete" }
  | { kind: "picker"; replace: string | null }
  | { kind: "notes"; blockId: string }
  | { kind: "rest"; blockId: string }
  | { kind: "target"; blockId: string; setId: string }
  | { kind: "extra"; blockId: string; setId: string }
  | { kind: "removeSet"; blockId: string; setId: string }
  | { kind: "removeBlock"; blockId: string };

type Pair = { open: boolean; onClose: () => void };
type Dispatch = (action: EditAction) => void;

function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.sheetActions}>{children}</div>;
}

function Alert({ children }: { children: ReactNode }) {
  return <p className="notice notice--alert" role="alert">{children}</p>;
}

/** A form that goes to a server action, after anything still unsaved has been saved. */
export function SavedFirstForm({ action, dirty, flush, className = styles.sheetForm, children }: {
  className?: string;
  action: (data: FormData) => void | Promise<void>;
  dirty: () => boolean;
  flush: () => Promise<boolean>;
  children: (problem: string | null) => ReactNode;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (!dirty()) return;
    event.preventDefault();
    const form = event.currentTarget;
    setProblem(null);
    void flush().then((saved) => {
      if (saved) form.requestSubmit();
      else setProblem("The latest changes are not saved yet. Wait for Saved at the top, then try again.");
    });
  };
  return <form className={className} action={action} onSubmit={submit}>{children(problem)}</form>;
}

export function ConfirmSheet({ open, onClose, title, children, confirm, keep, onConfirm }: Pair & {
  title: string; children: ReactNode; confirm: string; keep: string; onConfirm: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className={styles.sheetForm}>
        <p>{children}</p>
        <Actions>
          <button type="button" className="btn btn--danger" onClick={() => { onConfirm(); onClose(); }}>{confirm}</button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>{keep}</button>
        </Actions>
      </div>
    </Sheet>
  );
}

export function DetailsSheet({ open, onClose, doc, today, dispatch }: Pair & { doc: WorkoutDoc; today: string; dispatch: Dispatch }) {
  return (
    <Sheet open={open} title="Details" onClose={onClose}>
      <DetailsForm doc={doc} today={today} dispatch={dispatch} onClose={onClose} />
    </Sheet>
  );
}

function DetailsForm({ doc, today, dispatch, onClose }: { doc: WorkoutDoc; today: string; dispatch: Dispatch; onClose: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [day, setDay] = useState(doc.day ?? "");
  const [notes, setNotes] = useState(doc.notes);
  const [error, setError] = useState<string | null>(null);
  const session = doc.status !== "template";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError("Give the workout a name.");
    if (session && !day) return setError("Enter a date.");
    if (doc.status === "completed" && day > today) return setError("A completed session must be dated today or earlier.");
    dispatch({ type: "rename", title: title.trim() });
    if (session) dispatch({ type: "setDay", day });
    dispatch({ type: "setNotes", notes: notes.trim() });
    onClose();
  };

  return (
    <form className={styles.sheetForm} onSubmit={submit}>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label" htmlFor="d-title">Name</label>
        <input id="d-title" className="field" value={title} maxLength={limits.title} autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
      </div>
      {session && (
        <div>
          <label className="label" htmlFor="d-day">Date</label>
          <input id="d-day" className="field" type="date" value={day} max={doc.status === "completed" ? today : undefined} onChange={(event) => setDay(event.target.value)} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="d-notes">
          Notes {session && <span className="hint">The notes are published with the session.</span>}
        </label>
        <textarea id="d-notes" className="textarea" value={notes} maxLength={limits.notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <Actions>
        <button type="submit" className="btn">Save details</button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
      </Actions>
    </form>
  );
}

export function NotesSheet({ open, onClose, block, name, dispatch }: Pair & { block: BlockDoc | undefined; name: string; dispatch: Dispatch }) {
  return (
    <Sheet open={open} title={`Notes, ${name}`} onClose={onClose}>
      {block && <NotesForm block={block} dispatch={dispatch} onClose={onClose} />}
    </Sheet>
  );
}

function NotesForm({ block, dispatch, onClose }: { block: BlockDoc; dispatch: Dispatch; onClose: () => void }) {
  const [notes, setNotes] = useState(block.notes);
  return (
    <form className={styles.sheetForm} onSubmit={(event) => {
      event.preventDefault();
      dispatch({ type: "setBlockNotes", blockId: block.id, notes: notes.trim() });
      onClose();
    }}>
      <div>
        <label className="label" htmlFor="n-notes">Notes for this exercise</label>
        <textarea id="n-notes" className="textarea" value={notes} maxLength={limits.blockNotes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <Actions>
        <button type="submit" className="btn">Save notes</button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
      </Actions>
    </form>
  );
}

const QUICK_REST = [60, 90, 120, 150, 180, 240];

export function RestSheet({ open, onClose, block, exercise, dispatch }: Pair & { block: BlockDoc | undefined; exercise: ExerciseInfo | undefined; dispatch: Dispatch }) {
  return (
    <Sheet open={open} title="Rest time" onClose={onClose}>
      {block && <RestForm block={block} fallback={exercise?.restSeconds ?? DEFAULT_REST_SECONDS} dispatch={dispatch} onClose={onClose} />}
    </Sheet>
  );
}

function RestForm({ block, fallback, dispatch, onClose }: { block: BlockDoc; fallback: number; dispatch: Dispatch; onClose: () => void }) {
  const [text, setText] = useState(block.restSeconds === null ? "" : String(block.restSeconds));
  const [error, setError] = useState<string | null>(null);

  const save = (seconds: number | null) => {
    dispatch({ type: "setBlockRest", blockId: block.id, restSeconds: seconds });
    onClose();
  };

  return (
    <form className={styles.sheetForm} onSubmit={(event) => {
      event.preventDefault();
      const seconds = parseNumberInput(text, { integer: true, max: limits.restSeconds });
      if (seconds === "invalid") return setError(`Enter whole seconds, 0 to ${limits.restSeconds}.`);
      save(seconds);
    }}>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label" htmlFor="r-seconds">Rest after each set <span className="hint">seconds</span></label>
        <input
          id="r-seconds" className="field" inputMode="numeric" enterKeyHint="done" autoComplete="off"
          value={text} placeholder={String(fallback)} aria-invalid={error ? true : undefined}
          onChange={(event) => { setText(event.target.value); setError(null); }}
        />
      </div>
      <div className={styles.quick}>
        {QUICK_REST.map((seconds) => (
          <button key={seconds} type="button" className="btn btn--plain btn--small" aria-pressed={text === String(seconds)} onClick={() => { setText(String(seconds)); setError(null); }}>
            {seconds} s
          </button>
        ))}
      </div>
      <Actions>
        <button type="submit" className="btn">Save rest time</button>
        <button type="button" className="btn btn--quiet" onClick={() => save(null)}>Use the exercise default</button>
      </Actions>
    </form>
  );
}

export function TargetSheet({ open, onClose, block, set, exercise, dispatch }: Pair & { block: BlockDoc | undefined; set: SetDoc | undefined; exercise: ExerciseInfo | undefined; dispatch: Dispatch }) {
  const specs = fieldSpecs(exercise?.tracking ?? "weight_reps", true);
  return (
    <Sheet open={open} title="Edit target" onClose={onClose}>
      {block && set && (
        <div className={styles.sheetForm}>
          <p className="soft small">The target is what the plan asked for. What you lift is entered in the row.</p>
          <div className={styles.sheetFields}>
            {specs.map((spec) => (
              <div key={spec.key}>
                <span className="label" aria-hidden="true">{spec.long}</span>
                <MeasureInput
                  className="field" codec={spec.codec} value={spec.read(set.target)} label={`Target ${spec.long}`}
                  inputMode={spec.inputMode}
                  onValue={(value) => dispatch({ type: "editTarget", blockId: block.id, setId: set.id, patch: spec.write(value) })}
                />
              </div>
            ))}
            <div>
              <span className="label" aria-hidden="true">RPE</span>
              <MeasureInput
                className="field" codec={rpeCodec} value={set.target.rpe} label="Target RPE"
                onValue={(value) => dispatch({ type: "editTarget", blockId: block.id, setId: set.id, patch: { rpe: value } })}
              />
            </div>
          </div>
          <Actions><button type="button" className="btn" onClick={onClose}>Done</button></Actions>
        </div>
      )}
    </Sheet>
  );
}

export function ExtraFieldsSheet({ open, onClose, block, set, fields, dispatch }: Pair & { block: BlockDoc | undefined; set: SetDoc | undefined; fields: FieldInfo[]; dispatch: Dispatch }) {
  const mine = fields.filter((field) => block && (field.exerciseId === null || field.exerciseId === block.exerciseId));
  return (
    <Sheet open={open} title="Extra set fields" onClose={onClose}>
      {block && set && (
        <div className={styles.sheetForm}>
          <div className={styles.sheetFields}>
            {mine.map((field) => {
              const label = field.unit ? `${field.label} (${field.unit})` : field.label;
              const value = set.custom[field.id];
              const edit = (next: string | number | null) => dispatch({ type: "editCustom", blockId: block.id, setId: set.id, fieldId: field.id, value: next });
              return (
                <div key={field.id}>
                  <span className="label" aria-hidden="true">{label}</span>
                  {field.kind === "text" ? (
                    <input className="field" aria-label={label} autoComplete="off" maxLength={limits.customText} value={typeof value === "string" ? value : ""} onChange={(event) => edit(event.target.value || null)} />
                  ) : (
                    <MeasureInput
                      className="field" label={label} inputMode={field.kind === "integer" ? "numeric" : "decimal"}
                      codec={field.kind === "integer" ? integerCodec(1e9) : decimalCodec(1e9)}
                      value={typeof value === "number" ? value : null}
                      onValue={edit}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <Actions><button type="button" className="btn" onClick={onClose}>Done</button></Actions>
        </div>
      )}
    </Sheet>
  );
}

export function FinishSheet({ open, onClose, doc, status, dispatch, flush }: Pair & {
  doc: WorkoutDoc; status: SyncStatus; dispatch: Dispatch; flush: () => Promise<boolean>;
}) {
  return (
    <Sheet open={open} title="Finish session" onClose={onClose}>
      <FinishForm doc={doc} status={status} dispatch={dispatch} flush={flush} onClose={onClose} />
    </Sheet>
  );
}

function FinishForm({ doc, status, dispatch, flush, onClose }: { doc: WorkoutDoc; status: SyncStatus; dispatch: Dispatch; flush: () => Promise<boolean>; onClose: () => void }) {
  const router = useRouter();
  const [notes, setNotes] = useState(doc.notes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const sets = allSets(doc);
  const done = sets.filter(isLogged);
  const skipped = sets.length - done.length;
  const summary = summarizeSets(sets);
  const first = doc.startedAt ?? done.map((set) => set.loggedAt!).sort()[0] ?? null;
  const minutes = first ? Math.max(0, (now - new Date(first).valueOf()) / 60000) : null;

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      dispatch({ type: "setNotes", notes: notes.trim() });
      if (!(await flush())) {
        setError(status.kind === "invalid" ? status.message : "The latest sets are not saved yet. Check the connection and try again. Nothing is lost, it is kept on this phone.");
        setBusy(false);
        return;
      }
      const result = await completeWorkoutAction(doc.id);
      if (!result.ok) {
        setError(result.message);
        setBusy(false);
        return;
      }
      router.push(`/training/${doc.id}`);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
      setBusy(false);
    }
  };

  return (
    <form className={styles.sheetForm} onSubmit={finish}>
      {error && <Alert>{error}</Alert>}
      <table className="facts">
        <caption className="sr">Session summary</caption>
        <tbody>
          <tr><th scope="row">Sets done</th><td className="num">{done.length} of {sets.length}</td></tr>
          <tr><th scope="row">Working sets</th><td className="num">{summary.workSets}</td></tr>
          <tr><th scope="row">Volume</th><td className="num">{formatTotal(summary.volume)} kg</td></tr>
          {minutes !== null && minutes >= 1 && <tr><th scope="row">Time</th><td className="num">{formatSpan(minutes)}</td></tr>}
        </tbody>
      </table>
      {skipped > 0 && <p>{skipped === 1 ? "1 set was not done. It stays private." : `${skipped} sets were not done. They stay private.`}</p>}
      <div>
        <label className="label" htmlFor="f-notes">Notes <span className="hint">Published with the session.</span></label>
        <textarea id="f-notes" className="textarea" value={notes} maxLength={limits.notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <Actions>
        <button type="submit" className="btn" disabled={busy}>{busy ? "Finishing" : "Finish and publish"}</button>
        <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>Keep going</button>
      </Actions>
    </form>
  );
}

export function SaveTemplateSheet({ open, onClose, doc, dirty, flush }: Pair & { doc: WorkoutDoc; dirty: () => boolean; flush: () => Promise<boolean> }) {
  return (
    <Sheet open={open} title="Save as template" onClose={onClose}>
      <SavedFirstForm action={saveAsTemplateAction} dirty={dirty} flush={flush}>
        {(problem) => <TemplateFields doc={doc} problem={problem} onClose={onClose} />}
      </SavedFirstForm>
    </Sheet>
  );
}

function TemplateFields({ doc, problem, onClose }: { doc: WorkoutDoc; problem: string | null; onClose: () => void }) {
  const [id] = useState(newId);
  return (
    <>
      {problem && <Alert>{problem}</Alert>}
      <input type="hidden" name="workout_id" value={doc.id} />
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="label" htmlFor="t-title">Template name</label>
        <input id="t-title" className="field" name="title" defaultValue={doc.title} maxLength={limits.title} autoComplete="off" required />
      </div>
      <p className="soft small">The sets you did become the targets. The session stays as it is.</p>
      <Actions>
        <SubmitButton pending="Saving">Save as template</SubmitButton>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
      </Actions>
    </>
  );
}

export function PlanDaySheet({ open, onClose, doc, today, dirty, flush }: Pair & { doc: WorkoutDoc; today: string; dirty: () => boolean; flush: () => Promise<boolean> }) {
  return (
    <Sheet open={open} title="Plan for another day" onClose={onClose}>
      <SavedFirstForm action={startWorkoutAction} dirty={dirty} flush={flush}>
        {(problem) => <PlanFields doc={doc} tomorrow={addDays(today, 1)} problem={problem} onClose={onClose} />}
      </SavedFirstForm>
    </Sheet>
  );
}

function PlanFields({ doc, tomorrow, problem, onClose }: { doc: WorkoutDoc; tomorrow: string; problem: string | null; onClose: () => void }) {
  const [id] = useState(newId);
  return (
    <>
      {problem && <Alert>{problem}</Alert>}
      <input type="hidden" name="kind" value="planned" />
      <input type="hidden" name="template_id" value={doc.id} />
      <input type="hidden" name="when" value="day" />
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="label" htmlFor="p-day">Date</label>
        <input id="p-day" className="field" type="date" name="day" defaultValue={tomorrow} required />
      </div>
      <Actions>
        <SubmitButton pending="Planning">Plan session</SubmitButton>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
      </Actions>
    </>
  );
}

export function DeleteSheet({ open, onClose, doc }: Pair & { doc: WorkoutDoc }) {
  const template = doc.status === "template";
  return (
    <Sheet open={open} title={template ? "Delete template" : "Delete session"} onClose={onClose}>
      <form className={styles.sheetForm} action={deleteWorkoutAction}>
        <input type="hidden" name="workout_id" value={doc.id} />
        <p>
          {template
            ? `Delete the template ${doc.title}? Sessions already started from it are kept.`
            : `Delete ${doc.title} and every set in it? ${doc.status === "completed" ? "It is also removed from the public log. " : ""}This cannot be undone.`}
        </p>
        <Actions>
          <SubmitButton className="btn btn--danger" pending="Deleting">{template ? "Delete template" : "Delete session"}</SubmitButton>
          <button type="button" className="btn btn--quiet" onClick={onClose}>{template ? "Keep template" : "Keep session"}</button>
        </Actions>
      </form>
    </Sheet>
  );
}
