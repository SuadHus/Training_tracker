import Link from "next/link";
import { after } from "next/server";
import { syncStaleHealthProviders } from "@/src/lib/health-sync";
import { requireOwner } from "@/src/lib/owner";
import { query } from "@/src/lib/db";
import { formatNumber, isDay, stockholmDay } from "@/src/lib/workout-doc";
import { withingsMorningWeight, type DailyVitals } from "@/src/lib/public-data";
import { Icon } from "@/app/ui/icons";
import { SubmitButton } from "@/app/ui/submit-button";
import { dayLabel, dayLong } from "@/src/lib/day-format";
import styles from "../owner.module.css";
import { createPost, saveVitals } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publishing", robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  day: "That is not a valid date. Pick a date and load the day again.",
  vitals: "The vitals were not saved. Use whole numbers: heart rate must be 1 to 300, sleep 0 to 1440 minutes and sleep score 0 to 100. Fix the value and save again.",
  title: "The entry needs a title of at most 150 characters. Enter one and create the draft again.",
};

export default async function Studio({ searchParams }: { searchParams: Promise<{ day?: string; saved?: string; error?: string }> }) {
  await requireOwner();
  after(() => syncStaleHealthProviders());
  const params = await searchParams;
  const day = params.day && isDay(params.day) ? params.day : stockholmDay();
  const [posts, vitals, observations] = await Promise.all([
    query<{ id: string; title: string; published_at: string | null; updated: string }>("SELECT id, title, published_at, to_char(updated_at AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD') AS updated FROM journal_posts ORDER BY updated_at DESC"),
    query<DailyVitals>("SELECT * FROM published_daily_vitals WHERE local_day = $1", [day]),
    query<{ provider: string; metric: string; value: string }>(
      `SELECT provider, metric, value FROM health_observations o WHERE local_day = $1 AND
       ((provider = 'google-health' AND metric IN ('resting_heart_rate', 'sleep_minutes'))
        OR (${withingsMorningWeight})) ORDER BY provider, metric`, [day],
    ),
  ]);
  const entry = vitals.rows[0];
  const metricNames: Record<string, string> = {
    resting_heart_rate: "Resting heart rate (bpm)",
    sleep_minutes: "Sleep duration (minutes)",
    body_weight_kg: "Morning bodyweight (kg)",
  };
  return <>
    <div className="row opener row--stack">
      <h1 className={styles.full}>Publishing</h1>
    </div>

    {(params.saved || params.error) && (
      <div className="row row--flush row--stack">
        <div />
        {params.saved && <p className="notice" role="status">Day vitals saved.</p>}
        {params.error && <p className="notice notice--alert" role="alert">{errors[params.error] ?? "That did not save. Check what you entered and try again."}</p>}
      </div>
    )}

    <div className="row row--section row--stack">
      <h2 className="row-margin">Journal</h2>
      <div>
        <form action={createPost} className="form">
          <div>
            <label className="label" htmlFor="post-title">New entry title</label>
            <input id="post-title" className="field" name="title" required maxLength={150} autoComplete="off" />
          </div>
          <div className="form-actions"><SubmitButton pending="Creating">Create draft</SubmitButton></div>
        </form>
        {posts.rows.length > 0 && (
          <ul className={`${styles.list} ${styles.stackTop}`}>
            {posts.rows.map((post) => (
              <li key={post.id} className={styles.item}>
                <span className={styles.title}>
                  <Link href={`/studio/journal/${post.id}`}>{post.title}</Link>
                  <span className={styles.entryDate}>Updated {dayLabel(post.updated)}</span>
                </span>
                <span className={post.published_at ? "tag tag--solid" : "tag"}>{post.published_at ? "Public" : "Draft"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>

    <div className="row row--section row--stack">
      <h2 className="row-margin">Day vitals</h2>
      <div>
        <p className={`soft ${styles.measure}`}>Values you enter appear on completed workouts for the selected date and take precedence over synced values.</p>
        <form className={`form-actions ${styles.dayForm}`} method="get">
          <div>
            <label className="label" htmlFor="vitals-day">Workout date</label>
            <input id="vitals-day" className="field" type="date" name="day" defaultValue={day} required aria-describedby="vitals-day-echo" />
            <p id="vitals-day-echo" className={styles.dateEcho}>Showing {dayLabel(day)}</p>
          </div>
          <SubmitButton className="btn btn--plain" pending="Loading">Load day</SubmitButton>
        </form>
        <h3 className={styles.sub}>{dayLong(day)}</h3>
        {observations.rows.length > 0 && (
          <details className={`${styles.preview} ${styles.tight}`}>
            <summary>Synced readings for this day<Icon name="down" small /></summary>
            <table className={`facts ${styles.readings}`}>
              <tbody>
                {observations.rows.map(({ provider, metric, value }) => {
                  const publicationEnabled = provider === "withings"
                    ? process.env.PUBLISH_WITHINGS === "true"
                    : process.env.PUBLISH_GOOGLE_HEALTH === "true";
                  return <tr key={`${provider}:${metric}`}>
                    <th scope="row">{metricNames[metric]}<span className={`hint ${styles.hintBlock}`}>{publicationEnabled ? (provider === "withings" ? "Public on workouts for this date" : "Public when there’s no manual value") : "Private"}</span></th>
                    <td className="num">{formatNumber(Number(value))}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </details>
        )}
        <form action={saveVitals} key={day} className="form">
          <input type="hidden" name="day" value={day} />
          <div className="form-pair">
            <div>
              <label className="label" htmlFor="v-hr">Resting heart rate <span className="hint">bpm</span></label>
              <input id="v-hr" className="field" type="number" inputMode="numeric" name="resting_heart_rate" min={1} max={300} defaultValue={entry?.resting_heart_rate ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="v-sleep">Sleep duration <span className="hint">minutes</span></label>
              <input id="v-sleep" className="field" type="number" inputMode="numeric" name="sleep_minutes" min={0} max={1440} defaultValue={entry?.sleep_minutes ?? ""} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="v-score">Fitbit Sleep Score <span className="hint">out of 100</span></label>
            <input id="v-score" className="field" type="number" inputMode="numeric" name="sleep_score" min={0} max={100} defaultValue={entry?.sleep_score ?? ""} />
          </div>
          <div className="form-actions"><SubmitButton pending="Saving">Save public vitals</SubmitButton></div>
        </form>
      </div>
    </div>
  </>;
}
