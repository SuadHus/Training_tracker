import { Fragment } from "react";
import { dayLong } from "@/src/lib/day-format";
import { publicTotals, publicWeeks } from "@/src/lib/public-data";
import { stockholmDay } from "@/src/lib/workout-doc";
import { plural } from "../_parts/format";
import { Opener } from "../_parts/opener";
import { WeekHeader, WeekSessions } from "../_parts/week";
import styles from "../public.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "All weeks" };

export default async function Training() {
  const today = stockholmDay();
  const [weeks, totals] = await Promise.all([publicWeeks(), publicTotals()]);

  return <>
    <Opener margin={weeks[0] && <span className="light">{weeks[0].start.slice(0, 4)}</span>}>
      <h1>All weeks</h1>
      <p className={styles.lede}>
        {totals.sessions > 0 && totals.firstDay
          ? <><b>{totals.sessions}</b> {plural(totals.sessions, "session", "sessions")} since {dayLong(totals.firstDay)}.</>
          : "Nothing logged yet."}
      </p>
    </Opener>
    {weeks.map((week, index) => {
      const year = week.start.slice(0, 4);
      const newYear = index > 0 && year !== weeks[index - 1].start.slice(0, 4);
      return (
        <Fragment key={week.start}>
          {newYear && <div className={`row ${styles.yearRow}`}><div className="row-margin light">{year}</div><div /></div>}
          <WeekHeader week={week} />
          <WeekSessions week={week} today={today} />
        </Fragment>
      );
    })}
  </>;
}
