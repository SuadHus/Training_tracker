import Link from "next/link";
import styles from "./(site)/public.module.css";

export const metadata = { title: "Nothing here" };

export default function RootNotFound() {
  return <>
    <header className="masthead">
      <div className="masthead-bar"><Link href="/" className="brand">Training Log</Link></div>
    </header>
    <main className="page" id="main" tabIndex={-1}>
      <div className={styles.rootOpener}>
        <h1>Nothing here</h1>
      </div>
      <p className="prose">This page does not exist, or the workout or entry was never published.</p>
      <p className={`prose ${styles.stackTop}`}><Link href="/" className={styles.tap}>Back to the log</Link></p>
    </main>
  </>;
}
