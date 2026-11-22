// The pure half of the logger's saving: what to do with a save result, when to retry,
// and what to do with a copy kept on the phone. No clock, no storage, no network.
import { draftOf, sameDraft } from "./workout-edit";
import type { WorkoutDoc, WorkoutDraft } from "./workout-doc";
import type { SaveResult } from "./workout-store";

export type Settled =
  | { kind: "saved"; revision: number; startedAt: string | null }
  /** The server already holds what was sent: only the reply was lost. */
  | { kind: "adopt"; revision: number; draft: WorkoutDraft; startedAt: string | null }
  | { kind: "replace"; doc: WorkoutDoc }
  | { kind: "invalid"; message: string }
  | { kind: "missing" };

/**
 * Read a save result. `sent` lists the drafts this session has sent since the last
 * confirmed save, newest last, so a conflict caused by our own lost reply is told
 * apart from an edit made on another device.
 */
export function settleSave(result: SaveResult, sent: readonly WorkoutDraft[]): Settled {
  if (result.ok) return { kind: "saved", revision: result.revision, startedAt: result.startedAt };
  if (result.reason === "conflict") {
    const theirs = draftOf(result.current);
    return sent.some((draft) => sameDraft(draft, theirs))
      ? { kind: "adopt", revision: result.current.revision, draft: theirs, startedAt: result.current.startedAt }
      : { kind: "replace", doc: result.current };
  }
  if (result.reason === "invalid") return { kind: "invalid", message: result.message };
  return { kind: "missing" };
}

const RETRY_MS = [2000, 5000, 15000] as const;

/** Wait before the nth retry (0 is the first): 2 s, 5 s, 15 s, then every 30 s. */
export function retryDelay(attempt: number): number {
  return RETRY_MS[attempt] ?? 30000;
}

export const MIRROR_PREFIX = "training-log:workout:";

export function mirrorKey(id: string): string {
  return `${MIRROR_PREFIX}${id}`;
}

export function writeMirror(revision: number, draft: WorkoutDraft): string {
  return JSON.stringify({ revision, draft });
}

/**
 * What to do with the copy kept on the phone when the page opens. A copy made from
 * the revision the server still holds, and that differs from it, is work the tab
 * closed on: apply it. Any other copy is stale.
 */
export function readMirror(raw: string | null, server: WorkoutDoc): { action: "apply"; draft: WorkoutDraft } | { action: "drop" } | { action: "none" } {
  if (raw === null) return { action: "none" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { action: "drop" };
    const { revision, draft } = parsed as { revision?: unknown; draft?: unknown };
    if (revision !== server.revision || typeof draft !== "object" || draft === null) return { action: "drop" };
    const candidate = draft as WorkoutDraft;
    if (typeof candidate.title !== "string" || typeof candidate.notes !== "string" || !Array.isArray(candidate.blocks)) {
      return { action: "drop" };
    }
    return sameDraft(candidate, draftOf(server)) ? { action: "drop" } : { action: "apply", draft: candidate };
  } catch {
    return { action: "drop" };
  }
}
