import type { ReactNode } from "react";
import styles from "../public.module.css";

/** The first row of a page. Without a margin note the title takes the full width on a phone. */
export function Opener({ margin, children }: { margin?: ReactNode; children: ReactNode }) {
  return (
    <div className={margin ? `row opener ${styles.openerTop}` : `row opener row--stack ${styles.openerTop} ${styles.bare}`}>
      <div className="row-margin">{margin}</div>
      <div className={styles.openerBody}>{children}</div>
    </div>
  );
}

/** A row of reading text under an opener, without a margin note. */
export function TextRow({ children }: { children: ReactNode }) {
  return (
    <div className={`row row--stack ${styles.bare}`}>
      <div className="row-margin" />
      <div>{children}</div>
    </div>
  );
}
