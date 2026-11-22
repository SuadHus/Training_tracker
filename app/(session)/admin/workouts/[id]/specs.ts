import type { SetTarget, Tracking } from "@/src/lib/workout-doc";
import {
  durationCodec, kilometreCodec, loadCodec, repsCodec, repsTargetCodec, type Codec,
} from "./field-input";

export type MeasureKey = "load" | "reps" | "duration" | "distance";

/** One input of a set row: what it edits and how its text is read. */
export type FieldSpec = {
  key: MeasureKey;
  head: string;
  /** The column head and the label of the input in the set editor. */
  long: string;
  // The codec's value type depends on the field, and the row only ever pairs a spec with its own value.
  codec: Codec<any>;
  inputMode: "decimal" | "numeric" | "text";
  /** A set needs at least one of these to count as done. */
  result: boolean;
  /** Shown in the empty field when there is no number to suggest. */
  hint?: string;
  read(source: SetTarget): any;
  write(value: any): Partial<SetTarget>;
};

const load = (tracking: Tracking): FieldSpec => ({
  key: "load", head: tracking === "bodyweight_reps" ? "+kg" : "kg", long: tracking === "bodyweight_reps" ? "Added weight, kg" : "Weight, kg",
  codec: loadCodec, inputMode: "decimal", result: false,
  read: (source) => source.load, write: (value) => ({ load: value }),
});

const reps = (target: boolean): FieldSpec => target
  ? {
    key: "reps", head: "Reps", long: "Reps, 5 or 8-12", codec: repsTargetCodec, inputMode: "text", result: true,
    read: (source) => ({ reps: source.reps, repsMax: source.repsMax }),
    write: (value) => ({ reps: value.reps, repsMax: value.repsMax }),
  }
  : {
    key: "reps", head: "Reps", long: "Reps", codec: repsCodec, inputMode: "numeric", result: true,
    read: (source) => source.reps, write: (value) => ({ reps: value }),
  };

const time: FieldSpec = {
  key: "duration", head: "Time", long: "Time, 90 or 1:30", codec: durationCodec, inputMode: "numeric", result: true, hint: "m:ss",
  read: (source) => source.duration, write: (value) => ({ duration: value }),
};

const distance: FieldSpec = {
  key: "distance", head: "km", long: "Distance, km", codec: kilometreCodec, inputMode: "decimal", result: true,
  read: (source) => source.distance, write: (value) => ({ distance: value }),
};

/** The inputs of a set row for an exercise, left to right. */
export function fieldSpecs(tracking: Tracking, target: boolean): FieldSpec[] {
  switch (tracking) {
    case "weight_reps":
    case "bodyweight_reps":
      return [load(tracking), reps(target)];
    case "duration":
      return [time];
    case "distance_duration":
      return [distance, time];
  }
}
