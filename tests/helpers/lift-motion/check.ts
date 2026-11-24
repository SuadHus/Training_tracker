import { makeLiftSet } from "../../../src/lib/lift-motion";
import type { LiftSet } from "../../../src/lib/lift-set";
import type { LiftKind } from "../../../src/lib/lifts";

/** Where the checks get their sets from: the model, or (in the mutation tests) a deliberately broken copy of it. */
export const source: { make: (kind: LiftKind, reps: number) => LiftSet } = { make: (kind, reps) => makeLiftSet(kind, { reps }) };
export const getSet = (kind: LiftKind, reps: number) => source.make(kind, reps);

export type Check = { id: string; value: number; lo: number; hi: number; note: string };
export const between = (id: string, value: number, lo: number, hi: number): Check => ({ id, value, lo, hi, note: "" });
export const atMost = (id: string, value: number, hi: number): Check => ({ id, value, lo: -Infinity, hi, note: "" });
export const atLeast = (id: string, value: number, lo: number): Check => ({ id, value, lo, hi: Infinity, note: "" });
export const passes = (c: Check) => Number.isFinite(c.value) && c.value >= c.lo - 1e-9 && c.value <= c.hi + 1e-9;
export const show = (c: Check) => `${passes(c) ? "ok  " : "FAIL"} ${c.id}: ${Number.isFinite(c.value) ? +c.value.toFixed(4) : c.value}  [${c.lo}, ${c.hi}]`;
