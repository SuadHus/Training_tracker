import { Fragment } from "react";
import { formatDistance, formatDuration, formatNumber, type Measures, type Tracking } from "@/src/lib/workout-doc";

/** A figure with tabular digits. The decimal point keeps its natural width. */
export function Num({ value }: { value: number }) {
  const [whole, fraction] = formatNumber(value).split(".");
  return <span className="num">{whole}{fraction !== undefined && <><span className="sep">.</span>{fraction}</>}</span>;
}

/** A clock time such as 1:02:05 with tabular digits. The colons keep their natural width. */
export function Clock({ seconds }: { seconds: number }) {
  return (
    <span className="num">
      {formatDuration(seconds).split(":").map((part, index) => (
        <Fragment key={index}>{index > 0 && <span className="sep">:</span>}{part}</Fragment>
      ))}
    </span>
  );
}

/**
 * One set, or a run of identical sets, as lifters write it: 140 × 5 × 3.
 * Bold load, light reps, effort raised. Added weight on a bodyweight exercise
 * reads +10 × 6, and unloaded reps read BW × 12.
 */
export function Notation({ measures, tracking = "weight_reps", count = 1, warmup = false }: {
  measures: Measures & { repsMax?: number | null };
  tracking?: Tracking;
  count?: number;
  warmup?: boolean;
}) {
  const { reps, repsMax = null, load, rpe, duration, distance } = measures;
  const times = <span className="times" aria-hidden="true">×</span>;
  const repeat = count > 1 && <><span className="sr"> times </span>{times}<span className="reps num">{count}</span><span className="sr"> sets</span></>;
  const effort = rpe !== null && <span className="rpe"><span className="sr">, RPE </span><Num value={rpe} /></span>;
  const className = warmup ? "notation warm" : "notation";

  if (reps !== null) {
    const bodyweight = tracking === "bodyweight_reps";
    const weight = load === null || (bodyweight && load === 0)
      ? (bodyweight ? <span className="load">BW</span> : null)
      : <span className="load">{bodyweight && "+"}<Num value={load} /></span>;
    const range = repsMax !== null && repsMax > reps;
    return <span className={className}>
      {weight}{weight && <><span className="sr"> kilograms, </span>{times}</>}
      <span className="reps num">{reps}{range && <>–{repsMax}</>}</span><span className="sr"> reps</span>
      {!weight && <span className="unit"> reps</span>}
      {repeat}{effort}
    </span>;
  }
  if (distance !== null) {
    return <span className={className}>
      <span className="load">{formatDistance(distance)}</span>
      {duration !== null && <span className="reps"> in <Clock seconds={duration} /></span>}
      {repeat}{effort}
    </span>;
  }
  if (duration !== null) {
    return <span className={className}>
      <span className="load"><Clock seconds={duration} /></span>
      {load !== null && load > 0 && <span className="reps"> with <Num value={load} /> kg</span>}
      {repeat}{effort}
    </span>;
  }
  if (load !== null) {
    return <span className={className}><span className="load"><Num value={load} /></span><span className="unit"> kg</span>{repeat}{effort}</span>;
  }
  return null;
}
