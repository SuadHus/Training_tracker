"use client";

import styles from "./public.module.css";
import { Opener, TextRow } from "./_parts/opener";

export default function PageError({ retry, reset }: { retry?: () => void; reset?: () => void }) {
  return <>
    <Opener><h1>This page did not load</h1></Opener>
    <TextRow>
      <p className="prose">Something went wrong on the server while reading the log. Try again, and if it keeps failing come back in a few minutes.</p>
      <p className={styles.stackTop}><button type="button" className="btn" onClick={() => (retry ?? reset)?.()}>Try again</button></p>
    </TextRow>
  </>;
}
