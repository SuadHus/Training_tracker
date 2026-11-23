"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { historyAction, reopenWorkoutAction } from "@/src/actions/training";
import { dayLabel } from "@/src/lib/day-format";
import {
  isLogged, limits, loggedCount, newId, nextSet, trackingLabels, type BlockDoc, type ExerciseInfo, type FieldInfo, type WorkoutDoc,
} from "@/src/lib/workout-doc";
import { starterSets, type ExerciseHistory } from "@/src/lib/workout-edit";
import { ExerciseBlock, addSetId, focusSoon } from "./block";
import type { MenuItem } from "./menu";
import { ExercisePicker } from "./picker";
import { RestTimer, restKey, type Rest } from "./rest-timer";
import styles from "./session.module.css";
import {
  ConfirmSheet, DeleteSheet, DetailsSheet, ExtraFieldsSheet, FinishSheet, NotesSheet, PlanDaySheet, RestSheet,
  SaveTemplateSheet, TargetSheet, type SheetState,
} from "./sheets";
import { StatusLine, TopBar } from "./topbar";
import { useWorkoutSync } from "./use-workout-sync";

const HISTORY_WAIT = 5000;

export function WorkoutSession({ initial, exercises: initialExercises, fields, histories: initialHistories, today, notice: initialNotice }: {
  initial: WorkoutDoc;
  exercises: ExerciseInfo[];
  fields: FieldInfo[];
  histories: Record<string, ExerciseHistory>;
  today: string;
  notice: string | null;
}) {
  const router = useRouter();
  const { doc, status, dispatch, flush, retryNow, isDirty } = useWorkoutSync(initial);
  const [exercises, setExercises] = useState(initialExercises);
  const [histories, setHistories] = useState(initialHistories);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [rest, setRest] = useState<Rest | null>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const fetched = useRef(new Set(initial.blocks.map((block) => block.exerciseId)));

  const template = doc.status === "template";
  const mode = template ? "plan" : doc.status === "completed" ? "log" : (doc.day ?? today) <= today ? "log" : "plan";
  // Deleted on another device: what is on the screen can be read but no longer saved, so nothing on it is offered.
  const gone = status.kind === "missing";
  const live = doc.status === "planned" && mode === "log" && !gone;
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const logged = loggedCount(doc);
  const next = live ? nextSet(doc) : null;
  const since = doc.startedAt ?? doc.blocks.flatMap((block) => block.sets).flatMap((set) => (set.loggedAt ? [set.loggedAt] : [])).sort()[0] ?? null;

  const close = useCallback((kind: SheetState["kind"]) => setSheet((current) => (current?.kind === kind ? null : current)), []);

  useEffect(() => {
    if (!initialNotice) return;
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {}
  }, [initialNotice]);

  useEffect(() => {
    if (!live) return;
    // Kept for the device, not for the tab: a phone that reopens the app between sets still has its countdown.
    try {
      const saved = localStorage.getItem(restKey(doc.id));
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<Rest>;
      if (typeof parsed.endsAt === "number" && typeof parsed.total === "number" && parsed.endsAt + 4000 > Date.now()) {
        setRest({ endsAt: parsed.endsAt, total: parsed.total });
      } else localStorage.removeItem(restKey(doc.id));
    } catch {}
  }, [doc.id, live]);

  const changeRest = useCallback((value: Rest | null) => {
    setRest(value);
    try {
      if (value) localStorage.setItem(restKey(doc.id), JSON.stringify(value));
      else localStorage.removeItem(restKey(doc.id));
    } catch {}
  }, [doc.id]);

  const startRest = useCallback((seconds: number) => {
    if (!live) return;
    // Keep the next set above the rest bar once the row has re-rendered.
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>('tr[aria-current="step"]');
      const last = row?.nextElementSibling?.classList.contains(styles.callout) ? row.nextElementSibling : row;
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      last?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
    }, 60);
    if (seconds <= 0) return;
    changeRest({ endsAt: Date.now() + seconds * 1000, total: seconds });
  }, [changeRest, live]);

  useEffect(() => {
    if (!live || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = () => {
      if (stopped || document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then((sentinel) => {
        if (stopped) void sentinel.release().catch(() => {});
        else lock = sentinel;
      }, () => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [live]);

  useEffect(() => {
    if (!scrollTo) return;
    const element = document.getElementById(`b-${scrollTo}`);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
    setScrollTo(null);
  }, [scrollTo, doc.blocks.length]);

  const historyFor = useCallback(async (exerciseId: string): Promise<ExerciseHistory | undefined> => {
    if (fetched.current.has(exerciseId)) return histories[exerciseId];
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), HISTORY_WAIT));
      const found = await Promise.race([historyAction([exerciseId], doc.day ?? today, doc.id), timeout]);
      fetched.current.add(exerciseId);
      setHistories((current) => ({ ...current, ...found }));
      return found[exerciseId];
    } catch {
      return undefined;
    }
  }, [doc.day, doc.id, histories, today]);

  const choose = async (exercise: ExerciseInfo) => {
    const replace = sheet?.kind === "picker" ? sheet.replace : null;
    const history = await historyFor(exercise.id);
    if (replace) {
      const block = doc.blocks.find((item) => item.id === replace);
      const same = exerciseById.get(block?.exerciseId ?? "")?.tracking === exercise.tracking;
      // Numbers only carry over to an exercise that records the same things. Logged ones are not cleared without asking.
      if (!same && block?.sets.some(isLogged)) return setSheet({ kind: "replaceBlock", blockId: replace, exerciseId: exercise.id });
      dispatch({ type: "replaceExercise", blockId: replace, exerciseId: exercise.id, clear: !same });
    } else {
      const block = { id: newId(), exerciseId: exercise.id, notes: "", restSeconds: null, sets: starterSets(exercise, history, template) };
      dispatch({ type: "addBlock", block });
      setScrollTo(block.id);
    }
    close("picker");
  };

  const reopen = async () => {
    if (!(await flush())) return setNotice("The latest changes are not saved yet. Wait for Saved at the top, then reopen.");
    try {
      const result = await reopenWorkoutAction(doc.id);
      if (!result.ok) return setNotice(result.message);
      router.refresh();
    } catch {
      setNotice("Could not reach the server. Check the connection and try again.");
    }
  };

  const removeBlock = useCallback((removed: BlockDoc) => {
    if (removed.sets.some(isLogged)) setSheet({ kind: "removeBlock", blockId: removed.id });
    else {
      dispatch({ type: "removeBlock", blockId: removed.id });
      focusSoon("add-exercise");
    }
  }, [dispatch]);

  const session = !template;
  const menu: MenuItem[] = [
    { label: "Details", icon: "pencil", onSelect: () => setSheet({ kind: "details" }) },
    ...(session ? [{ label: "Save as template", icon: "copy" as const, onSelect: () => setSheet({ kind: "saveTemplate" }) }] : []),
    ...(template ? [{ label: "Plan for another day", icon: "calendar" as const, onSelect: () => setSheet({ kind: "planDay" }) }] : []),
    ...(doc.status === "completed" ? [
      { label: "View public page", icon: "forward" as const, href: `/training/${doc.id}` },
      { label: "Reopen", icon: "back" as const, onSelect: reopen },
    ] : []),
    "separator",
    { label: "Delete", icon: "trash", danger: true, onSelect: () => setSheet({ kind: "delete" }) },
  ];

  const target = sheet && "blockId" in sheet ? doc.blocks.find((block) => block.id === sheet.blockId) : undefined;
  const targetSet = target && sheet && "setId" in sheet ? target.sets.find((set) => set.id === sheet.setId) : undefined;
  const targetExercise = target ? exerciseById.get(target.exerciseId) : undefined;
  const targetName = targetExercise?.name ?? "this exercise";
  const kind = sheet?.kind;

  return (
    <div className={styles.app} data-mode={mode}>
      <h1 className="sr">{doc.title}</h1>
      <TopBar
        doc={doc}
        mode={mode}
        logged={logged}
        gone={gone}
        items={menu}
        onDetails={() => setSheet({ kind: "details" })}
        onFinish={() => setSheet({ kind: "finish" })}
        onToday={() => dispatch({ type: "setDay", day: today })}
        dirty={isDirty}
        flush={flush}
      />
      <StatusLine status={status} onRetry={retryNow} since={live && logged > 0 ? since : null} />

      <div className={styles.content} inert={gone}>
        {notice && <p className="notice notice--alert" role="alert">{notice}</p>}
        {doc.status === "planned" && doc.day !== null && doc.day < today && logged === 0 && (
          <p className={styles.late}>
            Planned for {dayLabel(doc.day)}.{" "}
            <button type="button" className={styles.retry} onClick={() => dispatch({ type: "setDay", day: today })}>Move it to today</button>
          </p>
        )}

        {doc.blocks.length === 0 ? (
          <p className={styles.teach}>
            {template
              ? "Add exercises and their target sets. Start the template from the desk when you train."
              : "Add the first exercise. Sets you mark done are saved as you go."}
          </p>
        ) : (
          <ol className={styles.blocks}>
            {doc.blocks.map((block, index) => (
              <ExerciseBlock
                key={block.id}
                index={index}
                count={doc.blocks.length}
                block={block}
                exercise={exerciseById.get(block.exerciseId)}
                history={histories[block.exerciseId]}
                mode={mode}
                nextSetId={next?.set.id ?? null}
                fields={fields}
                dispatch={dispatch}
                open={setSheet}
                newId={newId}
                onLogged={startRest}
                onRemoveBlock={removeBlock}
              />
            ))}
          </ol>
        )}

        <button
          type="button" id="add-exercise" className={`btn btn--plain btn--wide ${styles.addExercise}`}
          disabled={doc.blocks.length >= limits.blocks} onClick={() => setSheet({ kind: "picker", replace: null })}
        >
          Add exercise
        </button>
      </div>

      {live && rest && <RestTimer rest={rest} onChange={changeRest} />}

      <DetailsSheet open={kind === "details"} onClose={() => close("details")} doc={doc} today={today} dispatch={dispatch} />
      <FinishSheet open={kind === "finish"} onClose={() => close("finish")} doc={doc} status={status} dispatch={dispatch} flush={flush} />
      <SaveTemplateSheet open={kind === "saveTemplate"} onClose={() => close("saveTemplate")} doc={doc} dirty={isDirty} flush={flush} />
      <PlanDaySheet open={kind === "planDay"} onClose={() => close("planDay")} doc={doc} today={today} dirty={isDirty} flush={flush} />
      <DeleteSheet open={kind === "delete"} onClose={() => close("delete")} doc={doc} />
      <NotesSheet open={kind === "notes"} onClose={() => close("notes")} block={target} name={targetName} dispatch={dispatch} />
      <RestSheet open={kind === "rest"} onClose={() => close("rest")} block={target} exercise={targetExercise} dispatch={dispatch} />
      <TargetSheet open={kind === "target"} onClose={() => close("target")} block={target} set={targetSet} exercise={targetExercise} dispatch={dispatch} />
      <ExtraFieldsSheet open={kind === "extra"} onClose={() => close("extra")} block={target} set={targetSet} fields={fields} dispatch={dispatch} />
      <ConfirmSheet
        open={kind === "removeSet"} onClose={() => close("removeSet")} title="Remove set"
        confirm="Remove set" keep="Keep set"
        onConfirm={() => {
          if (!target || !targetSet) return;
          dispatch({ type: "removeSet", blockId: target.id, setId: targetSet.id });
          focusSoon(addSetId(target.id));
        }}
      >
        This set is marked done. Removing it deletes what you logged.
      </ConfirmSheet>
      <ConfirmSheet
        open={kind === "removeBlock"} onClose={() => close("removeBlock")} title="Remove exercise"
        confirm="Remove exercise" keep="Keep exercise"
        onConfirm={() => {
          if (!target) return;
          dispatch({ type: "removeBlock", blockId: target.id });
          focusSoon("add-exercise");
        }}
      >
        {target ? `${targetName} has ${target.sets.filter(isLogged).length} logged ${target.sets.filter(isLogged).length === 1 ? "set" : "sets"}. Removing it deletes them.` : ""}
      </ConfirmSheet>
      <ConfirmSheet
        open={kind === "replaceBlock"} onClose={() => close("replaceBlock")} title="Replace exercise"
        confirm="Replace and clear" keep="Keep exercise"
        onConfirm={() => {
          if (sheet?.kind === "replaceBlock") dispatch({ type: "replaceExercise", blockId: sheet.blockId, exerciseId: sheet.exerciseId, clear: true });
        }}
      >
        {target && sheet?.kind === "replaceBlock" ? (() => {
          const incoming = exerciseById.get(sheet.exerciseId);
          const count = target.sets.filter(isLogged).length;
          return `${incoming?.name ?? "The new exercise"} records ${trackingLabels[incoming?.tracking ?? "weight_reps"].toLowerCase()}, which ${targetName} does not. Replacing clears the numbers of ${targetName}, with its ${count} logged ${count === 1 ? "set" : "sets"}.`;
        })() : ""}
      </ConfirmSheet>
      <ExercisePicker
        open={kind === "picker"}
        title={sheet?.kind === "picker" && sheet.replace ? "Replace exercise" : "Add exercise"}
        onClose={() => close("picker")}
        exercises={exercises}
        histories={histories}
        onChoose={choose}
        onCreated={(exercise) => setExercises((current) => [...current, exercise])}
      />
    </div>
  );
}
