"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveWorkoutAction } from "@/src/actions/training";
import type { WorkoutDoc, WorkoutDraft } from "@/src/lib/workout-doc";
import { draftOf, editWorkout, sameDraft, type EditAction } from "@/src/lib/workout-edit";
import { mirrorKey, readMirror, retryDelay, settleSave, writeMirror } from "@/src/lib/workout-sync";

export type SyncStatus =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "updated" }
  | { kind: "invalid"; message: string }
  | { kind: "missing" };

const TYPING_DELAY = 800;
const GIVE_UP_AFTER = 30000;

/** Typing waits for a pause; everything else is saved at once. */
const typing = new Set<EditAction["type"]>(["rename", "setNotes", "setBlockNotes", "editTarget", "editActual", "editCustom"]);

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), GIVE_UP_AFTER);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * The workout as held in this tab, and the saving of it. Edits apply to local state at
 * once and never wait on the network. One save runs at a time; whatever changed while
 * it was away is saved when it returns. Unsaved work is mirrored to localStorage.
 */
export function useWorkoutSync(initial: WorkoutDoc) {
  const [doc, setDoc] = useState(initial);
  const [status, setStatus] = useState<SyncStatus>({ kind: "saved" });
  const docRef = useRef(initial);
  const revision = useRef(initial.revision);
  const savedDraft = useRef<WorkoutDraft>(draftOf(initial));
  const sentDrafts = useRef<WorkoutDraft[]>([]);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempts = useRef(0);
  const pumping = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const gone = useRef(false);
  const id = initial.id;

  const isDirty = useCallback(() => !sameDraft(draftOf(docRef.current), savedDraft.current), []);

  const adopt = useCallback((patch: Partial<WorkoutDoc>) => {
    docRef.current = { ...docRef.current, ...patch };
    setDoc(docRef.current);
  }, []);

  const run = useCallback(async () => {
    while (isDirty() && !blocked.current && !gone.current) {
      const draft = draftOf(docRef.current);
      sentDrafts.current = [...sentDrafts.current.slice(-5), draft];
      setStatus((current) => (current.kind === "saving" ? current : { kind: "saving" }));
      let result;
      try {
        result = await withTimeout(saveWorkoutAction(id, revision.current, draft));
      } catch {
        setStatus({ kind: "offline" });
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { void kick(); }, retryDelay(attempts.current));
        attempts.current += 1;
        return;
      }
      attempts.current = 0;
      const settled = settleSave(result, sentDrafts.current);
      if (settled.kind === "saved") {
        revision.current = settled.revision;
        savedDraft.current = draft;
        sentDrafts.current = [];
        adopt({ revision: settled.revision, startedAt: settled.startedAt ?? docRef.current.startedAt });
      } else if (settled.kind === "adopt") {
        revision.current = settled.revision;
        savedDraft.current = settled.draft;
        sentDrafts.current = [];
        adopt({ revision: settled.revision, startedAt: settled.startedAt ?? docRef.current.startedAt });
      } else if (settled.kind === "replace") {
        clearTimeout(typingTimer.current);
        revision.current = settled.doc.revision;
        savedDraft.current = draftOf(settled.doc);
        sentDrafts.current = [];
        docRef.current = settled.doc;
        setDoc(settled.doc);
        setStatus({ kind: "updated" });
        return;
      } else if (settled.kind === "invalid") {
        blocked.current = true;
        setStatus({ kind: "invalid", message: settled.message });
        return;
      } else {
        gone.current = true;
        setStatus({ kind: "missing" });
        return;
      }
    }
    if (!isDirty()) setStatus({ kind: "saved" });
  }, [adopt, id, isDirty]);

  const kick = useCallback((): Promise<void> => {
    if (pumping.current) return pumping.current;
    const pass: Promise<void> = run().finally(() => {
      if (pumping.current === pass) pumping.current = null;
    });
    pumping.current = pass;
    return pass;
  }, [run]);

  const dispatch = useCallback((action: EditAction) => {
    const next = editWorkout(docRef.current, action);
    if (next === docRef.current) return;
    docRef.current = next;
    setDoc(next);
    blocked.current = false;
    clearTimeout(typingTimer.current);
    if (!isDirty()) {
      // Typed and then put back: nothing to send, so a "Saving" left from the first edit would never clear.
      if (!pumping.current) setStatus((current) => (current.kind === "missing" ? current : { kind: "saved" }));
      return;
    }
    setStatus((current) => (current.kind === "offline" ? current : { kind: "saving" }));
    if (typing.has(action.type)) typingTimer.current = setTimeout(() => { void kick(); }, TYPING_DELAY);
    else void kick();
  }, [isDirty, kick]);

  /** Save everything now and say whether nothing is left unsaved. */
  const flush = useCallback(async () => {
    clearTimeout(typingTimer.current);
    clearTimeout(retryTimer.current);
    blocked.current = false;
    await kick();
    return !isDirty() && !gone.current;
  }, [isDirty, kick]);

  const retryNow = useCallback(() => {
    clearTimeout(retryTimer.current);
    attempts.current = 0;
    blocked.current = false;
    void kick();
  }, [kick]);

  useEffect(() => {
    try {
      const found = readMirror(localStorage.getItem(mirrorKey(id)), docRef.current);
      if (found.action === "drop") localStorage.removeItem(mirrorKey(id));
      if (found.action === "apply") {
        adopt({ ...found.draft });
        setStatus({ kind: "saving" });
        void kick();
      }
    } catch {}
  }, [adopt, id, kick]);

  useEffect(() => {
    try {
      if (isDirty()) localStorage.setItem(mirrorKey(id), writeMirror(revision.current, draftOf(docRef.current)));
      else localStorage.removeItem(mirrorKey(id));
    } catch {}
  }, [doc, status, id, isDirty]);

  useEffect(() => {
    const wake = () => {
      if (!isDirty()) return;
      clearTimeout(typingTimer.current);
      clearTimeout(retryTimer.current);
      attempts.current = 0;
      void kick();
    };
    const visibility = () => { if (document.visibilityState === "hidden" || document.visibilityState === "visible") wake(); };
    window.addEventListener("online", wake);
    window.addEventListener("pagehide", wake);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("online", wake);
      window.removeEventListener("pagehide", wake);
      document.removeEventListener("visibilitychange", visibility);
      clearTimeout(typingTimer.current);
      clearTimeout(retryTimer.current);
    };
  }, [isDirty, kick]);

  return { doc, status, dispatch, flush, retryNow, isDirty };
}
