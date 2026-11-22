import Link from "next/link";
import { requireOwner } from "@/src/lib/owner";
import { query } from "@/src/lib/db";
import { numberLabel, stockholmDay, validDay } from "@/src/lib/training-public";
import { withingsMorningWeight, type DailyVitals } from "@/src/lib/public-data";
import { createPost, saveVitals } from "./actions";

export const metadata = { title: "Publishing", robots: { index: false, follow: false } };

export default async function Studio({ searchParams }: { searchParams: Promise<{ day?: string; saved?: string; error?: string }> }) {
  await requireOwner();
  const params = await searchParams;
  const day = params.day && validDay(params.day) ? params.day : stockholmDay();
  const [posts, vitals, observations] = await Promise.all([
    query<{ id: string; title: string; published_at: string | null }>("SELECT id, title, published_at FROM journal_posts ORDER BY updated_at DESC"),
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
    <section className="intro">
      <Link href="/admin" className="back-link">← Owner workspace</Link>
      <h1>Publishing</h1>
    </section>
    {params.saved && <p role="status">Day vitals saved.</p>}
    {params.error && <p role="alert">Check the workout date, entry title, or vitals and try again.</p>}
    <div className="home-grid">
      <section>
        <div className="section-heading"><h2>Journal entries</h2></div>
        <form action={createPost} className="form-stack">
          <label>New entry title<input name="title" required maxLength={150} /></label>
          <button type="submit">Create draft</button>
        </form>
        <ul className="progress-lifts">
          {posts.rows.map((post) => <li key={post.id}><Link href={`/studio/journal/${post.id}`}>{post.title}</Link><small>{post.published_at ? "Public" : "Draft"}</small></li>)}
        </ul>
      </section>
      <section>
        <div className="section-heading"><h2>Public day vitals</h2></div>
        <p className="muted">Manually entered values appear on completed workouts for the selected date and take precedence over synced values.</p>
        <form className="form-stack" method="get">
          <label>Workout date<input type="date" name="day" defaultValue={day} required /></label>
          <button type="submit" className="secondary">Load day</button>
        </form>
        {observations.rows.length > 0 && <details className="post-preview">
          <summary>Synced readings for this day</summary>
          <ul className="progress-lifts">
            {observations.rows.map(({ provider, metric, value }) => {
              const publicationEnabled = provider === "withings"
                ? process.env.PUBLISH_WITHINGS === "true"
                : process.env.PUBLISH_GOOGLE_HEALTH === "true";
              return <li key={`${provider}:${metric}`}>
                <span>{metricNames[metric]}<small>{publicationEnabled ? (provider === "withings" ? "Public on workouts for this date" : "Public when there’s no manual value") : "Private"}</small></span>
                <strong>{numberLabel.format(Number(value))}</strong>
              </li>;
            })}
          </ul>
        </details>}
        <form action={saveVitals} key={day} className="form-stack">
          <input type="hidden" name="day" value={day} />
          <label>Resting heart rate (bpm)<input type="number" name="resting_heart_rate" min={1} max={300} defaultValue={entry?.resting_heart_rate ?? ""} /></label>
          <label>Sleep duration (minutes)<input type="number" name="sleep_minutes" min={0} max={1440} defaultValue={entry?.sleep_minutes ?? ""} /></label>
          <label>Fitbit Sleep Score (out of 100)<input type="number" name="sleep_score" min={0} max={100} defaultValue={entry?.sleep_score ?? ""} /></label>
          <button type="submit">Save public vitals</button>
        </form>
      </section>
    </div>
  </>;
}
