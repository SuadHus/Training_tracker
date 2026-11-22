"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./owner.module.css";

/** A destructive form that asks in the page, not in a browser dialog: the button turns into a confirm and a keep. */
export function ConfirmForm({ action, label, subject, confirmLabel, keepLabel, children }: {
  action: (form: FormData) => void | Promise<void>;
  label: string;
  subject: string;
  confirmLabel: string;
  keepLabel: string;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (wasAsking.current) trigger.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  return (
    <form action={action} className={asking ? `${styles.confirm} ${styles.asking}` : styles.confirm}>
      {children}
      {asking ? (
        <>
          <button className="btn btn--danger btn--small">{confirmLabel}<span className="sr">: {subject}</span></button>
          <button type="button" ref={keep} className="btn btn--plain btn--small" onClick={() => setAsking(false)}>{keepLabel}</button>
        </>
      ) : (
        <button type="button" ref={trigger} className={`btn btn--quiet ${styles.dangerQuiet}`} onClick={() => setAsking(true)}>{label}<span className="sr"> {subject}</span></button>
      )}
    </form>
  );
}
