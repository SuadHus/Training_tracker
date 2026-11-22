"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "@/app/ui/notation";
import styles from "./session.module.css";

export type Rest = { endsAt: number; total: number };

const OVER_MS = 4000;

export function restKey(id: string): string {
  return `training-log:rest:${id}`;
}

/**
 * The rest bar. It counts down to an absolute end time, so a sleeping phone or a
 * background tab cannot make it slow: every tick and every return to the tab
 * reads the clock again.
 */
export function RestTimer({ rest, onChange }: { rest: Rest; onChange: (rest: Rest | null) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [rest.endsAt]);

  const left = Math.max(0, rest.endsAt - now);
  const over = now >= rest.endsAt;

  useEffect(() => {
    if (!over || buzzed.current === rest.endsAt) return;
    buzzed.current = rest.endsAt;
    if (Date.now() - rest.endsAt < 2000) navigator.vibrate?.(200);
  }, [over, rest.endsAt]);

  useEffect(() => {
    if (now >= rest.endsAt + OVER_MS) onChange(null);
  }, [now, rest.endsAt, onChange]);

  const shift = (seconds: number) => {
    const endsAt = rest.endsAt + seconds * 1000;
    const remaining = Math.ceil((endsAt - Date.now()) / 1000);
    onChange({ endsAt, total: Math.max(rest.total, remaining) });
  };
  const share = rest.total > 0 ? Math.min(1, left / (rest.total * 1000)) : 0;

  return (
    <div className={styles.rest} role="timer" aria-label="Rest timer">
      <div className={styles.restLine}><i style={{ width: `${share * 100}%` }} /></div>
      <div className={styles.restInner}>
        <div className={styles.restTime}>
          {over ? <span className={styles.restOver}>Rest over</span> : <Clock seconds={Math.ceil(left / 1000)} />}
          <small>{over ? "Next set when you are ready" : <>Rest, of <Clock seconds={rest.total} /></>}</small>
        </div>
        <button type="button" className={styles.restBtn} onClick={() => shift(-15)} disabled={over}>−15 s</button>
        <button type="button" className={styles.restBtn} onClick={() => shift(15)} disabled={over}>+15 s</button>
        <button type="button" className={`${styles.restBtn} ${styles.restSkip}`} onClick={() => onChange(null)}>Skip</button>
      </div>
      <span className="sr" role="status">{over ? "Rest over" : ""}</span>
    </div>
  );
}
