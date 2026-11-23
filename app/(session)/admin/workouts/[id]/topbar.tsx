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

export function TopBar({ doc, mode, logged, gone, items, onDetails, onFinish, onToday, dirty, flush }: {
  doc: WorkoutDoc;
  mode: "plan" | "log";
  logged: number;
  /** The workout was deleted elsewhere: nothing on this screen can be saved any more. */
  gone: boolean;
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
        <button
          type="button" className={styles.title} onClick={onDetails}
          aria-label={`${doc.title}, ${template ? "Template" : `${dayLabel(doc.day!)}, ${weekLabel(doc.day!)}, ${weekName(doc.day!)}`}. Edit details`}
        >
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
        <button type="button" className="btn" disabled={logged === 0 || gone} onClick={onFinish}>Finish</button>
      )}
      {doc.status === "planned" && mode === "plan" && <button type="button" className="btn" onClick={onToday}>Do it today</button>}
      {doc.status === "completed" && <Link href="/admin" className="btn btn--quiet">Close</Link>}
      {!gone && <Menu label="More" items={items} />}
    </header>
  );
}

/** What a screen reader is told. Saving and Saved come and go with every set and are left unsaid. */
const spoken: Partial<Record<SyncStatus["kind"], string>> = {
  offline: "Offline. Changes are kept on this phone and sent when the connection is back.",
  updated: "Updated with changes made elsewhere.",
  merged: "Combined with changes made elsewhere. Check the sets.",
  signedOut: "Signed out. Changes are kept on this phone.",
  missing: "This workout was deleted on another device.",
};

export function StatusLine({ status, onRetry, since }: { status: SyncStatus; onRetry: () => void; since: string | null }) {
  if (status.kind === "invalid") {
    return <div className={styles.status}><div className={`${styles.statusText} ${styles.statusAlert}`} role="alert">{status.message}</div></div>;
  }
  const long = status.kind !== "saved" && status.kind !== "saving" && status.kind !== "updated";
  return (
    <div className={styles.status}>
      <div className={`${styles.statusText} ${long ? styles.statusLong : ""}`}>
      {status.kind === "saved" && "Saved"}
      {status.kind === "saving" && "Saving"}
      {status.kind === "updated" && spoken.updated}
      {status.kind === "merged" && spoken.merged}
      {status.kind === "offline" && (
        <>{spoken.offline} <button type="button" className={styles.retry} onClick={onRetry}>Retry now</button></>
      )}
      {status.kind === "signedOut" && (
        <>
          {spoken.signedOut} <a href="/login" target="_blank" rel="noopener" className={styles.retry}>Sign in</a>{" "}
          <button type="button" className={styles.retry} onClick={onRetry}>Retry now</button>
        </>
      )}
      {status.kind === "missing" && (
        <>{spoken.missing} <Link href="/admin" className={styles.retry}>Back to desk</Link></>
      )}
      </div>
      <div className="sr" role="status">{spoken[status.kind] ?? ""}</div>
      {since && <Elapsed since={since} />}
    </div>
  );
}
