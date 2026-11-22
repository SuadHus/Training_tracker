import Link from "next/link";
import styles from "./public.module.css";
import { Opener, TextRow } from "./_parts/opener";

export const metadata = { title: "Nothing here" };

export default function NotFound() {
  return <>
    <Opener><h1>Nothing here</h1></Opener>
    <TextRow>
      <p className="prose">This page does not exist, or the workout or entry was never published.</p>
      <p className={`prose ${styles.stackTop}`}><Link href="/" className={styles.tap}>Back to the log</Link></p>
    </TextRow>
  </>;
}
