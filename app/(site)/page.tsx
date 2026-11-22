import Link from "next/link";
import { BarLoad } from "@/app/ui/bar-load";
import { Notation } from "@/app/ui/notation";
import { WeekDots, WeekDotsHead, WeekStrip } from "@/app/ui/week-strip";
import { dateLabel, dayLabel, weekAnchor, weekRange } from "@/src/lib/day-format";
import { publicBestLifts, publicJournal, publicWeeks, type BestLift } from "@/src/lib/public-data";
import { formatTotal, platesPerSide, STANDARD_BAR_KG, stockholmDay, weekStart } from "@/src/lib/workout-doc";
import { excerptOf } from "./_parts/format";
import { HeaviestBar, trainedDays, WeekHeader, WeekSessions, WeekText, WeekTotals } from "./_parts/week";
import styles from "./public.module.css";

export const dynamic = "force-dynamic";

const platesFor = (lift: BestLift) => platesPerSide(lift.load, lift.barKg ?? STANDARD_BAR_KG) !== null;

export default async function Home() {
  const today = stockholmDay();
  const thisWeek = weekStart(today);
  const [weeks, lifts, [post]] = await Promise.all([publicWeeks({ limit: 9 }), publicBestLifts(6), publicJournal(1)]);

  const current = weeks.find((week) => week.start === thisWeek);
  const open = weeks[0];
  const earlier = weeks.slice(1);
  // A best lift means something once there is more than one session to be best among.
  const sessionCount = weeks.reduce((count, week) => count + week.sessions.length, 0);
  const barLifts = lifts.some((lift) => lift.equipment === "barbell" && platesFor(lift));

  return <>
    <div className={`row opener ${styles.homeOpener}`}>
      <div className="row-margin">
        <h1 className="week-no"><WeekText day={thisWeek} /></h1>
        <small>{weekRange(thisWeek)}</small>
      </div>
      <div className={styles.openerBody}>
        <WeekStrip start={thisWeek} trained={current ? trainedDays(current) : new Set()} today={today} />
        {!weeks.length ? <p className={styles.totals}>Nothing logged yet.</p>
          : current ? <WeekTotals week={current} sofar />
          : <p className={styles.totals}>No sessions yet this week.</p>}
      </div>
    </div>

    {open && <>
      {open.start !== thisWeek && <WeekHeader week={open} />}
      <HeaviestBar week={open} />
      <WeekSessions week={open} today={today} underHero />
    </>}

    {earlier.length > 0 && (
      <section className="row row--section row--stack" aria-labelledby="earlier">
        <h2 className="row-margin" id="earlier">Earlier weeks</h2>
        <div>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col"><span className="sr">Days trained</span><WeekDotsHead /></th>
                <th scope="col" className="r">Sessions</th>
                <th scope="col" className="r">kg</th>
              </tr>
            </thead>
            <tbody>
              {earlier.map((week) => (
                <tr key={week.start}>
                  <th scope="row" className={styles.weekCell}>
                    <Link href={`/training#${weekAnchor(week.start)}`} className={styles.tap}>
                      <span className={`week-no ${styles.tableWeek}`}><WeekText day={week.start} /></span>
                    </Link>
                    <small>{weekRange(week.start)}</small>
                  </th>
                  <td><WeekDots start={week.start} trained={trainedDays(week)} /></td>
                  <td className="r strong num">{week.sessions.length}</td>
                  <td className="r strong num nowrap">{formatTotal(week.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.after}><Link href="/training" className={styles.tap}>All weeks</Link></p>
        </div>
      </section>
    )}

    {lifts.length > 0 && sessionCount > 1 && (
      <section className="row row--section row--stack" aria-labelledby="best">
        <h2 className="row-margin" id="best">Best estimated lifts</h2>
        <div>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Lift</th>
                <th scope="col">Set</th>
                {barLifts && <th scope="col" className={styles.barCol}><span className="sr">Bar</span></th>}
                <th scope="col" className="r">Est. 1RM kg<span aria-hidden="true">*</span></th>
              </tr>
            </thead>
            <tbody>
              {lifts.map((lift) => {
                const bar = lift.equipment === "barbell" && platesFor(lift)
                  ? <BarLoad load={lift.load} barKg={lift.barKg} size="row" /> : null;
                return (
                  <tr key={lift.exerciseId}>
                    <th scope="row"><Link href={`/training/${lift.workoutId}`} className={styles.tap}>{lift.name}</Link></th>
                    <td>
                      <Notation measures={{ reps: lift.reps, load: lift.load, rpe: null, duration: null, distance: null }} />
                      <span className={styles.sub}>{dayLabel(lift.day)}</span>
                      {bar && <span className={styles.barInSet} aria-hidden="true">{bar}</span>}
                    </td>
                    {barLifts && <td className={styles.barCol}>{bar}</td>}
                    <td className="r strong num nowrap">{formatTotal(lift.estimate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.footnote}>* Epley estimate from one working set: load × (1 + reps ÷ 30).</p>
        </div>
      </section>
    )}

    {post && (
      <section className="row row--section row--stack" aria-labelledby="journal">
        <h2 className="row-margin" id="journal">Journal<small>{dateLabel(post.day, today.slice(0, 4))}</small></h2>
        <div>
          <h3 className={styles.journalTitle}><Link href={`/journal/${post.id}`}>{post.title}</Link></h3>
          <p className="prose">{excerptOf(post.excerpt)}</p>
          <p className={styles.after}><Link href="/journal" className={styles.tap}>All entries</Link></p>
        </div>
      </section>
    )}
  </>;
}
