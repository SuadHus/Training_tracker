"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newId, type WorkoutDoc, type WorkoutDraft } from "@/src/lib/workout-doc";
import { draftOf, editWorkout, sameDraft, type EditAction } from "@/src/lib/workout-edit";
import type { SaveResult } from "@/src/lib/workout-store";
import { copyKey, isCopyKey, readMirrors, rebaseDraft, retryDelay, settleSave, writeMirror } from "@/src/lib/workout-sync";

export type SyncStatus =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "offline" }
  /** A newer version came from another device, and this tab had nothing unsaved. */
  | { kind: "updated" }
  /** A newer version came from another device, and this tab's unsaved work was carried over to it. */
  | { kind: "merged" }
  | { kind: "signedOut" }
  | { kind: "invalid"; message: string }
  | { kind: "missing" };

const TYPING_DELAY = 800;
const GIVE_UP_AFTER = 20000;
// How many unanswered drafts are remembered. The server holding one of them means only
// replies were lost, and the tab's work stands exactly as it is.
const SENT_KEPT = 40;
// A request marked keepalive outlives the page, which saves the last tap before a tab
// closes. Browsers only allow it for small bodies.
const KEEPALIVE_BYTES = 60000;

/** Typing waits for a pause; everything else is saved at once. */
const typing = new Set<EditAction["type"]>(["rename", "setNotes", "setBlockNotes", "editTarget", "editActual", "editCustom"]);

/**
 * One save. A request that gets no answer in time is cut off, so the next one can go
 * out; whether the server took it is found out from the answer to that next one.
 */
async function sendSave(id: string, baseRevision: number, draft: WorkoutDraft): Promise<SaveResult | "signed-out"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GIVE_UP_AFTER);
  try {
    const body = JSON.stringify({ baseRevision, draft });
    const response = await fetch(`/api/workouts/${id}/save`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal,
      credentials: "same-origin", cache: "no-store", keepalive: new Blob([body]).size < KEEPALIVE_BYTES,
    });
    if (response.status === 401) return "signed-out";
    if (!response.ok) throw new Error(`Save answered ${response.status}`);
    // Something between the phone and the server can answer in its place. Only an answer
    // of the right shape is believed; anything else is a failed request and is sent again.
    const answer = await response.json() as Partial<SaveResult> & Record<string, unknown>;
    const fine = answer !== null && typeof answer === "object" && (
      (answer.ok === true && typeof answer.revision === "number") ||
      (answer.ok === false && (
        (answer.reason === "conflict" && typeof answer.current === "object" && answer.current !== null) ||
        (answer.reason === "invalid" && typeof answer.message === "string") ||
        answer.reason === "missing"
      ))
    );
    if (!fine) throw new Error("Save answered something else");
    return answer as SaveResult;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The workout as held in this tab, and the saving of it. Edits apply to local state at
 * once and never wait on the network. One save runs at a time; whatever changed while
 * it was away is saved when it returns. Unsaved work is mirrored to localStorage, and
 * is carried over, never dropped, when the server turns out to hold a newer version.
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
  /** This tab wrote its copy on the phone, so it is this tab's to remove. */
  const copied = useRef(false);
  /** Unsaved work was combined with a newer version and is on its way to the server. */
  const combined = useRef(false);
  /** The server answered that nobody is signed in. Coming back to the tab tries again. */
  const signedOut = useRef(false);
  /** Each tab keeps its own copy, so two tabs on one workout cannot write over each other's unsaved work. */
  const tab = useRef("");
  if (!tab.current) tab.current = newId();
  const id = initial.id;

  const isDirty = useCallback(() => !sameDraft(draftOf(docRef.current), savedDraft.current), []);

  const adopt = useCallback((patch: Partial<WorkoutDoc>) => {
    docRef.current = { ...docRef.current, ...patch };
    setDoc(docRef.current);
  }, []);

  const keepCopy = useCallback(() => {
    try {
      if (isDirty()) {
        localStorage.setItem(copyKey(id, tab.current), writeMirror(revision.current, draftOf(docRef.current), savedDraft.current, sentDrafts.current));
        copied.current = true;
      } else if (copied.current) {
        localStorage.removeItem(copyKey(id, tab.current));
        copied.current = false;
      }
    } catch {}
  }, [id, isDirty]);

  const run = useCallback(async () => {
    while (isDirty() && !blocked.current && !gone.current) {
      const draft = draftOf(docRef.current);
      sentDrafts.current = [...sentDrafts.current.slice(1 - SENT_KEPT), draft];
      // The copy must know what is on its way before the request leaves.
      keepCopy();
      // While retries are failing the line keeps saying Offline; it says Saving again once one gets through.
      setStatus((current) => (current.kind === "saving" || (current.kind === "offline" && attempts.current > 0) ? current : { kind: "saving" }));
      let result;
      try {
        result = await sendSave(id, revision.current, draft);
      } catch {
        setStatus({ kind: "offline" });
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { void kick(); }, retryDelay(attempts.current));
        attempts.current += 1;
        return;
      }
      attempts.current = 0;
      if (result === "signed-out") {
        blocked.current = true;
        signedOut.current = true;
        setStatus({ kind: "signedOut" });
        return;
      }
      signedOut.current = false;
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
      } else if (settled.kind === "rebase") {
        // Another device saved first. What this tab has not saved yet is carried over to that version.
        clearTimeout(typingTimer.current);
        const theirs = draftOf(settled.doc);
        const merged = rebaseDraft(savedDraft.current, draftOf(docRef.current), theirs);
        revision.current = settled.doc.revision;
        savedDraft.current = theirs;
        sentDrafts.current = [];
        docRef.current = { ...settled.doc, ...merged };
        setDoc(docRef.current);
        if (sameDraft(merged, theirs)) {
          combined.current = false;
          setStatus({ kind: "updated" });
          return;
        }
        combined.current = true;
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
    if (!isDirty()) {
      setStatus(combined.current ? { kind: "merged" } : { kind: "saved" });
      combined.current = false;
    }
  }, [adopt, id, isDirty, keepCopy]);

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

  // On opening: every copy of this workout left on the phone, by this tab before a reload
  // or by any other tab, is carried into this one.
  useEffect(() => {
    try {
      const keys: string[] = [];
      for (let at = 0; at < localStorage.length; at += 1) {
        const key = localStorage.key(at);
        if (key && key !== copyKey(id, tab.current) && isCopyKey(key, id)) keys.push(key);
      }
      keys.sort();
      const found = readMirrors(keys.map((key) => localStorage.getItem(key)), docRef.current);
      if (found.action === "apply") {
        combined.current = found.merged;
        adopt({ ...found.draft });
        // This tab's own copy is written before the others are let go, so the work is never without one.
        keepCopy();
        setStatus({ kind: "saving" });
        void kick();
      }
      if (found.action !== "none" && (found.action === "drop" || copied.current)) keys.forEach((key) => localStorage.removeItem(key));
    } catch {}
  }, [adopt, id, keepCopy, kick]);

  useEffect(() => {
    keepCopy();
  }, [doc, status, keepCopy]);

  useEffect(() => {
    const wake = () => {
      if (!isDirty()) return;
      clearTimeout(typingTimer.current);
      clearTimeout(retryTimer.current);
      attempts.current = 0;
      // Signed in again in another tab: the work that was waiting goes out without another edit.
      if (signedOut.current) blocked.current = false;
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
