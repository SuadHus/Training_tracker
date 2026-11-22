import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarLoad, perSide } from "@/app/ui/bar-load";
import { Num } from "@/app/ui/notation";
import { dayLabel, dayLong, weekAnchor } from "@/src/lib/day-format";
import { publicWorkout } from "@/src/lib/public-data";
import { exerciseMeta, formatSpan, formatTotal, isId } from "@/src/lib/workout-doc";
import { Opener } from "../../_parts/opener";
import { WeekText } from "../../_parts/week";
import { Dec, SetTable, topOf } from "../../_parts/sets";
import styles from "../../public.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const workout = isId(id) ? await publicWorkout(id) : null;
  return { title: workout ? `${workout.title}, ${dayLong(workout.day)}` : "Workout" };
}

function Sleep({ minutes }: { minutes: number }) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return <>
    {hours > 0 && <>{hours} <span className="unit">h</span> </>}
    {(rest > 0 || hours === 0) && <>{rest} <span className="unit">min</span></>}
  </>;
}

export default async function WorkoutPage({ params }: Props) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const workout = await publicWorkout(id);
  if (!workout) notFound();

  const { summary, vitals, muscles, older, newer } = workout;
  const morning = [
    vitals?.body_weight_kg != null && ["Bodyweight", <><Dec value={vitals.body_weight_kg} /> <span className="unit">kg</span></>],
    vitals?.sleep_minutes != null && ["Sleep", <Sleep minutes={vitals.sleep_minutes} />],
    vitals?.resting_heart_rate != null && ["Resting heart rate", <><Num value={vitals.resting_heart_rate} /> <span className="unit">bpm</span></>],
    vitals?.sleep_score != null && ["Sleep score", <Num value={vitals.sleep_score} />],
  ].filter((row) => row !== false) as Array<[string, React.ReactNode]>;
  const hasSets = summary.workSets > 0;

  return <>
    <Opener margin={<>
      <Link href={`/training#${weekAnchor(workout.day)}`} className={`${styles.plain} ${styles.tap}`}>
        <span className="week-no"><WeekText day={workout.day} /></span>
      </Link>
      <small>{dayLong(workout.day)}</small>
    </>}>
      <h1>{workout.title}</h1>
      {workout.notes && <p className={`prose prose--pre ${styles.lead}`}>{workout.notes}</p>}
    </Opener>

    {workout.blocks.map((block, index) => {
      const top = topOf(block);
      const bar = block.exercise.barKg;
      const topSet = top && (
        <div className={styles.top}>
          <BarLoad load={top.load} barKg={bar} size="tool" />
          <p className="per-side">Top set <b><Num value={top.load} /></b> kg, per side <b>{perSide(top.load, bar)}</b></p>
        </div>
      );
      return (
        <div className="row" key={block.id}>
          <div className="row-margin"><span className={styles.exNo}><span className="sr">Exercise </span>{index + 1}</span></div>
          <div>
            <div className={styles.exHead}>
              <div className={styles.exTitle}>
                <h2>{block.exercise.name}</h2>
                <p className={styles.meta}>{exerciseMeta(block.exercise)}</p>
                {block.notes && <p className={`prose prose--pre ${styles.blockNotes}`}>{block.notes}</p>}
              </div>
              {topSet}
            </div>
            <SetTable block={block} fields={workout.fields} />
          </div>
        </div>
      );
    })}

    {(hasSets || morning.length > 0) && (
      <section className="row row--section row--stack" aria-labelledby="session">
        <h2 className="row-margin" id="session">Session</h2>
        <div>
          <div className="facts-pair">
            {hasSets && (
              <table className="facts">
                <caption>Totals</caption>
                <tbody>
                  <tr><th scope="row">Working sets</th><td className="num">{summary.workSets}</td></tr>
                  {summary.volume > 0 && <tr><th scope="row">Volume</th><td className="num">{formatTotal(summary.volume)}&#8201;<span className="unit">kg</span></td></tr>}
                  {workout.minutes !== null && <tr><th scope="row">Duration</th><td className="num">{formatSpan(workout.minutes)}</td></tr>}
                  {summary.averageRpe !== null && <tr><th scope="row">Average RPE</th><td><Dec value={summary.averageRpe} /></td></tr>}
                </tbody>
              </table>
            )}
            {morning.length > 0 && (
              <table className="facts">
                <caption>That morning</caption>
                <tbody>
                  {morning.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td className="num">{value}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
          {vitals?.sleep_minutes != null && <p className={styles.footnote}>Sleep is shown for the day it ended.</p>}
          {muscles.length >= 2 && (
            <table className={`facts ${styles.muscles}`}>
              <caption>Working sets by muscle</caption>
              <tbody>
                {muscles.map((muscle) => <tr key={muscle.name}><th scope="row">{muscle.name}</th><td className="num">{muscle.sets}</td></tr>)}
              </tbody>
            </table>
          )}
        </div>
      </section>
    )}

    {(older || newer) && (
      <nav className={`row row--stack ${styles.bare}`} aria-label="Neighbouring sessions">
        <div className="row-margin" />
        <ul className={styles.neighbours}>
          {older && <li><span className="soft">Earlier: </span><Link className={styles.tap} href={`/training/${older.id}`}>{older.title}, {dayLabel(older.day)}</Link></li>}
          {newer && <li><span className="soft">Later: </span><Link className={styles.tap} href={`/training/${newer.id}`}>{newer.title}, {dayLabel(newer.day)}</Link></li>}
        </ul>
      </nav>
    )}
  </>;
}
