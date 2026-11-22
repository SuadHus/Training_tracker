"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { startWorkoutAction } from "@/src/actions/training";
import { Icon } from "@/app/ui/icons";
import { Clock } from "@/app/ui/notation";
import { SubmitButton } from "@/app/ui/submit-button";
import { dayLabel, weekLabel, weekName } from "@/src/lib/day-format";
import { newId, type WorkoutDoc } from "@/src/lib/workout-doc";
import { Menu, type MenuItem } from "./menu";
import styles from "./session.module.css";
import { SavedFirstForm } from "./sheets";
import type { SyncStatus } from "./use-workout-sync";

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const total = Math.max(0, Math.floor((now - new Date(since).valueOf()) / 1000));
  return <span className={styles.elapsed} role="timer" aria-label="Time since the first set"><Clock seconds={total} /></span>;
}

export function TopBar({ doc, mode, logged, items, onDetails, onFinish, onToday, dirty, flush }: {
  doc: WorkoutDoc;
  mode: "plan" | "log";
  logged: number;
  items: MenuItem[];
  onDetails: () => void;
  onFinish: () => void;
  onToday: () => void;
  dirty: () => boolean;
  flush: () => Promise<boolean>;
}) {
  const template = doc.status === "template";
  const [startId, setStartId] = useState("");
  useEffect(() => setStartId(newId()), []);

  return (
    <header className={styles.topbar}>
      <Link href={template ? "/admin/templates" : "/admin"} className="icon-btn" aria-label="Back to desk"><Icon name="back" /></Link>
      <div className={styles.titleBox}>
        <button type="button" className={styles.title} onClick={onDetails}>
          <b>{doc.title}</b>
          <span>
            {template ? "Template" : <>{dayLabel(doc.day!)}, <span aria-hidden="true">{weekLabel(doc.day!)}</span><span className="sr">{weekName(doc.day!)}</span></>}
          </span>
        </button>
      </div>
      {template && (
        <SavedFirstForm className={styles.startForm} action={startWorkoutAction} dirty={dirty} flush={flush}>
          {() => (
            <>
              <input type="hidden" name="kind" value="planned" />
              <input type="hidden" name="template_id" value={doc.id} />
              <input type="hidden" name="when" value="today" />
              <input type="hidden" name="id" value={startId} />
              <SubmitButton pending="Starting">Start</SubmitButton>
            </>
          )}
        </SavedFirstForm>
      )}
      {doc.status === "planned" && mode === "log" && (
        <button type="button" className="btn" disabled={logged === 0} onClick={onFinish}>Finish</button>
      )}
      {doc.status === "planned" && mode === "plan" && <button type="button" className="btn" onClick={onToday}>Do it today</button>}
      {doc.status === "completed" && <Link href="/admin" className="btn btn--quiet">Close</Link>}
      <Menu label="More" items={items} />
    </header>
  );
}

export function StatusLine({ status, onRetry, since }: { status: SyncStatus; onRetry: () => void; since: string | null }) {
  if (status.kind === "invalid") {
    return <div className={styles.status}><div className={`${styles.statusText} ${styles.statusAlert}`} role="alert">{status.message}</div></div>;
  }
  const long = status.kind === "offline" || status.kind === "missing";
  return (
    <div className={styles.status}>
      <div className={`${styles.statusText} ${long ? styles.statusLong : ""}`} role="status">
      {status.kind === "saved" && "Saved"}
      {status.kind === "saving" && "Saving"}
      {status.kind === "updated" && "Updated from another device."}
      {status.kind === "offline" && (
        <>
          Offline. Changes are kept on this phone and sent when the connection is back.{" "}
          <button type="button" className={styles.retry} onClick={onRetry}>Retry now</button>
        </>
      )}
      {status.kind === "missing" && (
        <>This workout was deleted on another device. <Link href="/admin" className={styles.retry}>Back to desk</Link></>
      )}
      </div>
      {since && <Elapsed since={since} />}
    </div>
  );
}
