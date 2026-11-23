// The pure half of the logger's saving: what to do with a save result, when to retry,
// what to do with a copy kept on the phone, and how to carry unsaved work over to a
// newer version from the server. No clock, no storage, no network.
import { draftOf, sameDraft, sameValue } from "./workout-edit";
import { hasResult, isId, isLogged, type BlockDoc, type SetDoc, type WorkoutDoc, type WorkoutDraft } from "./workout-doc";
import type { SaveResult } from "./workout-store";

export type Settled =
  | { kind: "saved"; revision: number; startedAt: string | null }
  /** The server already holds what was sent: only the reply was lost. */
  | { kind: "adopt"; revision: number; draft: WorkoutDraft; startedAt: string | null }
  /** The server holds something newer from elsewhere: this tab's unsaved work is carried over to it. */
  | { kind: "rebase"; doc: WorkoutDoc }
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
      : { kind: "rebase", doc: result.current };
  }
  if (result.reason === "invalid") return { kind: "invalid", message: result.message };
  return { kind: "missing" };
}

const RETRY_MS = [2000, 5000, 15000] as const;

/** Wait before the nth retry (0 is the first): 2 s, 5 s, 15 s, then every 30 s. */
export function retryDelay(attempt: number): number {
  return RETRY_MS[attempt] ?? 30000;
}

// Carrying unsaved work over to a newer version ---------------------------------

type Keyed = { id: string };

/** `follow` woven into `lead`: an id only `follow` has goes right after the id that precedes it there. */
function weave(lead: readonly string[], follow: readonly string[]): string[] {
  const order = [...lead];
  follow.forEach((id, index) => {
    if (order.includes(id)) return;
    order.splice(index === 0 ? 0 : order.indexOf(follow[index - 1]) + 1, 0, id);
  });
  return order;
}

/**
 * Three lists of the same things, matched by id. What only one side changed is kept;
 * `mergeOne` settles a thing both sides hold. A thing this side removed stays removed
 * unless `rescued` says the other side has since done something that must not be lost.
 * With no base nothing counts as removed: both sides' things are all kept.
 */
function mergeList<T extends Keyed>(
  base: readonly T[] | null, mine: readonly T[], theirs: readonly T[],
  mergeOne: (base: T | undefined, mine: T, theirs: T) => T, rescued: (base: T, theirs: T) => boolean,
): T[] {
  const old = base ? new Map(base.map((item) => [item.id, item])) : null;
  const own = new Map(mine.map((item) => [item.id, item]));
  const other = new Map(theirs.map((item) => [item.id, item]));
  const kept = new Map<string, T>();
  for (const item of theirs) {
    const here = own.get(item.id);
    const before = old?.get(item.id);
    if (here) kept.set(item.id, mergeOne(before, here, item));
    else if (!before || rescued(before, item)) kept.set(item.id, item);
  }
  for (const item of mine) {
    if (other.has(item.id)) continue;
    const before = old?.get(item.id);
    // Removed on the other side: it comes back only if this side did something to it.
    if (!before || !sameValue(item, before)) kept.set(item.id, item);
  }
  const ids = (list: readonly T[]) => list.map((item) => item.id).filter((id) => kept.has(id));
  const shared = (list: readonly T[]) => list.map((item) => item.id).filter((id) => own.has(id) && other.has(id) && (!old || old.has(id)));
  // The order follows the other side unless this side moved things since the base.
  const movedHere = !base || !sameValue(shared(mine), shared(base));
  const order = movedHere ? weave(ids(mine), ids(theirs)) : weave(ids(theirs), ids(mine));
  return order.map((id) => kept.get(id)!);
}

/** Key by key: this side's value where it changed it since the base, else the other side's. */
function mergeRecord<T extends object>(base: T | undefined, mine: T, theirs: T): T {
  const merged: Record<string, unknown> = {};
  const read = (from: T | undefined, key: string) => (from as Record<string, unknown> | undefined)?.[key];
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const value = base === undefined || !sameValue(read(mine, key), read(base, key)) ? read(mine, key) : read(theirs, key);
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

/**
 * One set. Its plan (warm-up or not, targets) is merged field by field. Its result is
 * one thing: the numbers belong to the tick that logged them, so a side that logged
 * the set brings its numbers with it and they are never mixed with the other side's.
 * Where both sides logged it, this side's stands.
 */
function mergeSet(base: SetDoc | undefined, mine: SetDoc, theirs: SetDoc): SetDoc {
  if (sameValue(mine, theirs)) return theirs;
  const plan = {
    id: mine.id,
    warmup: base === undefined || mine.warmup !== base.warmup ? mine.warmup : theirs.warmup,
    target: mergeRecord(base?.target, mine.target, theirs.target),
  };
  const whole = (side: SetDoc): SetDoc => ({ ...plan, actual: side.actual, custom: side.custom, loggedAt: side.loggedAt });
  const fields = (loggedAt: string | null): SetDoc => ({
    ...plan, loggedAt,
    actual: mergeRecord(base?.actual, mine.actual, theirs.actual),
    custom: mergeRecord(base?.custom, mine.custom, theirs.custom),
  });
  // Without a base nobody can say who un-logged a set: one that is logged on either side stays logged.
  const tickedHere = base === undefined ? isLogged(mine) : mine.loggedAt !== base.loggedAt;
  const tickedThere = base === undefined ? isLogged(theirs) : theirs.loggedAt !== base.loggedAt;
  let merged: SetDoc;
  if (tickedHere) merged = isLogged(mine) ? whole(mine) : fields(null);
  else if (tickedThere) merged = isLogged(theirs) ? whole(theirs) : fields(null);
  else {
    // Neither touched the tick: numbers typed on either side are combined.
    merged = fields(mine.loggedAt);
    if (isLogged(merged) && !hasResult(merged)) merged = whole(mine);
  }
  // Whatever came in, a tick never stays over nothing.
  return isLogged(merged) && !hasResult(merged) ? { ...merged, loggedAt: null } : merged;
}

const loggedSince = (base: SetDoc, theirs: SetDoc) => isLogged(theirs) && theirs.loggedAt !== base.loggedAt;

/** An exercise this side removed comes back if the other side has logged a set in it since. */
function blockLoggedSince(base: BlockDoc, theirs: BlockDoc): boolean {
  const before = new Map(base.sets.map((set) => [set.id, set]));
  return theirs.sets.some((set) => isLogged(set) && set.loggedAt !== before.get(set.id)?.loggedAt);
}

/** Which side put another exercise in a block, when the two sides no longer agree on it. */
function replacedBy(base: BlockDoc | undefined, mine: BlockDoc, theirs: BlockDoc): "mine" | "theirs" | null {
  if (mine.exerciseId === theirs.exerciseId) return null;
  // Changed here, changed on both sides, or nobody can tell: the phone in hand stands.
  return !base || mine.exerciseId !== base.exerciseId ? "mine" : "theirs";
}

/**
 * Carry this tab's unsaved work over to a newer version of the workout. `base` is what
 * the tab last knew the server held, `mine` what the tab holds now, `theirs` what the
 * server holds. Everything is matched by id and merged field by field: a change made
 * on one side only is kept, and where both sides changed the same thing this side wins,
 * because it is the phone in the lifter's hand. A logged set is never dropped by a merge.
 * With no base (a copy left by an older version) both sides' sets are all kept.
 *
 * One case cannot be merged inside a block: one side replaced the exercise while the
 * other logged sets of the old one. The block then stays as the replacing side has it,
 * and those logged sets move to a block of their own, right after it, under the
 * exercise they were logged for. Its id is derived from the two, so every tab that
 * meets the same case arrives at the same block.
 */
export function rebaseDraft(base: WorkoutDraft | null, mine: WorkoutDraft, theirs: WorkoutDraft): WorkoutDraft {
  const pick = <K extends "title" | "day" | "notes">(key: K): WorkoutDraft[K] =>
    base === null || mine[key] !== base[key] ? mine[key] : theirs[key];
  const split: Array<{ after: string; block: BlockDoc }> = [];

  const mergeBlock = (before: BlockDoc | undefined, here: BlockDoc, there: BlockDoc): BlockDoc => {
    if (sameValue(here, there)) return there;
    const replacer = replacedBy(before, here, there);
    if (replacer) {
      const [kept, other] = replacer === "mine" ? [here, there] : [there, here];
      const keptLogged = new Set(kept.sets.filter(isLogged).map((set) => set.id));
      const old = new Map((before?.sets ?? []).map((set) => [set.id, set]));
      const stranded = other.sets.filter((set) => isLogged(set) && !keptLogged.has(set.id) && set.loggedAt !== old.get(set.id)?.loggedAt);
      if (!stranded.length) return kept;
      const moved = new Set(stranded.map((set) => set.id));
      split.push({
        after: kept.id,
        block: { id: derivedId(kept.id, other.exerciseId), exerciseId: other.exerciseId, notes: other.notes, restSeconds: other.restSeconds, sets: stranded },
      });
      return { ...kept, sets: kept.sets.filter((set) => !moved.has(set.id)) };
    }
    const own = <K extends "notes" | "restSeconds">(key: K): BlockDoc[K] =>
      before === undefined || here[key] !== before[key] ? here[key] : there[key];
    return {
      id: here.id, exerciseId: here.exerciseId, notes: own("notes"), restSeconds: own("restSeconds"),
      sets: mergeList(before?.sets ?? null, here.sets, there.sets, mergeSet, loggedSince),
    };
  };

  const blocks = mergeList(base?.blocks ?? null, mine.blocks, theirs.blocks, mergeBlock, blockLoggedSince);
  for (const { after, block } of split) {
    const at = blocks.findIndex((item) => item.id === block.id);
    if (at === -1) blocks.splice(blocks.findIndex((item) => item.id === after) + 1, 0, block);
    else {
      // An earlier merge already made that block: it only takes the sets it does not hold yet.
      const held = new Set(blocks[at].sets.map((set) => set.id));
      blocks[at] = { ...blocks[at], sets: [...blocks[at].sets, ...block.sets.filter((set) => !held.has(set.id))] };
    }
  }
  // A set lives in one block. A stale tab can still hold, unlogged, a set that has since moved to a
  // block of its own: where two blocks name the same set, the block holding it logged keeps it, else the first.
  const home = new Map<string, number>();
  blocks.forEach((block, at) => block.sets.forEach((set) => {
    const held = home.get(set.id);
    if (held === undefined || (isLogged(set) && !isLogged(blocks[held].sets.find((other) => other.id === set.id)!))) home.set(set.id, at);
  }));
  const tidy = blocks.map((block, at) => {
    const sets = block.sets.filter((set) => home.get(set.id) === at);
    return sets.length === block.sets.length ? block : { ...block, sets };
  });
  return { title: pick("title"), day: pick("day"), notes: pick("notes"), blocks: tidy };
}

// The copy kept on the phone -----------------------------------------------------

export const MIRROR_PREFIX = "training-log:workout:";

/** Where copies of a workout are kept. Each tab keeps its own, under this key followed by its tab id. */
export function mirrorKey(id: string): string {
  return `${MIRROR_PREFIX}${id}`;
}

/** The key of one tab's copy. Two tabs on one workout never write over each other's unsaved work. */
export function copyKey(id: string, tab: string): string {
  return `${mirrorKey(id)}:${tab}`;
}

/** Whether a storage key holds a copy of this workout: a tab's, or the single one older versions wrote. */
export function isCopyKey(key: string, id: string): boolean {
  return key === mirrorKey(id) || key.startsWith(`${mirrorKey(id)}:`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Sixteen hex digits for a text. FNV-1a from two starting points: 64 bits, plenty to tell a handful of things apart. */
function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x811c9dc5) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** A short stand-in for a draft: equal drafts give equal text, whatever the order of their keys. */
export function fingerprint(draft: WorkoutDraft): string {
  return hashText(canonical(draft));
}

/** An id that follows from other ids, in the shape of every other id, so two tabs derive the same one. */
function derivedId(...from: string[]): string {
  const hex = hashText(`${from.join("|")}#a`) + hashText(`${from.join("|")}#b`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The copy holds the working draft, the revision and draft the server last confirmed
 * (the base a later merge needs), and fingerprints of the drafts sent since.
 */
export function writeMirror(revision: number, draft: WorkoutDraft, base: WorkoutDraft, sent: readonly WorkoutDraft[]): string {
  return JSON.stringify({ revision, draft, base, sent: sent.map(fingerprint) });
}

const numberOrNull = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const measures = (value: unknown, keys: readonly string[]) => record(value) && keys.every((key) => numberOrNull(value[key]));
const MEASURES = ["reps", "load", "rpe", "duration", "distance"] as const;

function setShape(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.warmup === "boolean" &&
    measures(value.target, [...MEASURES, "repsMax"]) && measures(value.actual, MEASURES) &&
    record(value.custom) && Object.values(value.custom).every((item) => typeof item === "string" || typeof item === "number") &&
    (value.loggedAt === null || typeof value.loggedAt === "string");
}

function blockShape(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.exerciseId === "string" && typeof value.notes === "string" &&
    numberOrNull(value.restSeconds) && Array.isArray(value.sets) && value.sets.every(setShape);
}

/**
 * Whether a value read back from storage has the shape of a draft, so that drawing it
 * cannot fail, and ids the server can take: each one well formed and used once. A copy
 * that fails here could never be saved, and would stand in the way of everything after it.
 */
export function isDraftShape(value: unknown): value is WorkoutDraft {
  if (!record(value) || typeof value.title !== "string" || !(value.day === null || typeof value.day === "string") ||
    typeof value.notes !== "string" || !Array.isArray(value.blocks) || !value.blocks.every(blockShape)) return false;
  const blocks = value.blocks as BlockDoc[];
  const ids = blocks.flatMap((block) => [block.id, ...block.sets.map((set) => set.id)]);
  return blocks.every((block) => isId(block.exerciseId)) && ids.every(isId) && new Set(ids).size === ids.length;
}

export type MirrorRead =
  /** `merged` says the copy was combined with a newer version, or with another tab's copy. */
  | { action: "apply"; draft: WorkoutDraft; merged: boolean }
  | { action: "drop" }
  | { action: "none" };

type Copy = { revision: unknown; draft: WorkoutDraft; base: WorkoutDraft | null; sent: unknown[] };

function parseCopy(raw: string): Copy | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record(parsed) || !isDraftShape(parsed.draft)) return null;
  return {
    revision: parsed.revision, draft: parsed.draft, base: isDraftShape(parsed.base) ? parsed.base : null,
    sent: Array.isArray(parsed.sent) ? parsed.sent : [],
  };
}

/**
 * What to do with the copies kept on the phone when the page opens: one per tab that
 * had unsaved work on this workout. A copy that differs from what the server holds is
 * work a tab closed on, and it is never thrown away. The first one made from the
 * revision the server still holds, or from a draft the server received while its
 * reply was lost, is taken as it is. Every other copy has its changes carried over:
 * to the newer version on the server, and to what the copies before it brought.
 */
export function readMirrors(raws: readonly (string | null)[], server: WorkoutDoc): MirrorRead {
  const present = raws.filter((raw): raw is string => raw !== null);
  if (!present.length) return { action: "none" };
  const theirs = draftOf(server);
  let current = theirs;
  let merged = false;
  for (const raw of present) {
    const copy = parseCopy(raw);
    if (!copy || sameDraft(copy.draft, current)) continue;
    const untouched = current === theirs;
    const whole = untouched && (copy.revision === server.revision || copy.sent.includes(fingerprint(theirs)));
    const next = whole ? copy.draft : rebaseDraft(copy.base, copy.draft, current);
    if (sameDraft(next, current)) continue;
    if (!whole) merged = true;
    current = next;
  }
  return current === theirs ? { action: "drop" } : { action: "apply", draft: current, merged };
}

/** One copy: see readMirrors. */
export function readMirror(raw: string | null, server: WorkoutDoc): MirrorRead {
  return readMirrors([raw], server);
}
