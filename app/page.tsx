import Link from "next/link";
import { publicProgress, publicJournal, publicWorkouts } from "@/src/lib/public-data";
import { displayDay, numberLabel } from "@/src/lib/training-public";
import { WorkoutList } from "./workout-list";

export const dynamic = "force-dynamic";

const shortDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", timeZone: "UTC",
});

export default async function Home() {
  const [workouts, posts, { weeks }] = await Promise.all([publicWorkouts(5), publicJournal(1), publicProgress()]);
  const week = weeks.at(-1);
  const peak = Math.max(1, ...weeks.map(({ tonnage }) => tonnage));
  const post = posts[0];

  return <>
    <section className="overview-hero" aria-labelledby="home-title">
      <div className="overview-intro">
        <h1 id="home-title">Training Log</h1>
        <p className="lede">Strength sessions, training progress, and notes from the process.</p>
        <Link href="/training" className="hero-link">Browse workout history <span aria-hidden="true">↗</span></Link>
      </div>
      <section className="week-panel" aria-labelledby="weekly-volume">
        <h2 id="weekly-volume" className="eyebrow">Work-set volume this week</h2>
        <p className="week-number">{numberLabel.format(week?.tonnage ?? 0)} <span>kg</span></p>
        <ol aria-label="Last six weeks of training volume, by week beginning" className="week-bars">
          {weeks.map(({ day, tonnage }, index) => {
            const current = index === weeks.length - 1;
            return <li key={day} className={current ? "current" : undefined} title={`${displayDay(day)} · ${numberLabel.format(tonnage)} kg`}>
              <span className="bar-track" aria-hidden="true"><span style={{ height: `${tonnage / peak * 100}%` }} /></span>
              <time dateTime={day}>{current ? "This week" : shortDay.format(new Date(day))}</time>
              <span className="sr-only">{numberLabel.format(tonnage)} kilograms</span>
            </li>;
          })}
        </ol>
        <dl className="week-metrics">
          <div><dt>Sessions</dt><dd>{numberLabel.format(week?.sessions ?? 0)}</dd></div>
          <div><dt>Working sets</dt><dd>{numberLabel.format(week?.work_sets ?? 0)}</dd></div>
        </dl>
      </section>
    </section>
    <div className="home-grid">
      <section aria-labelledby="recent-workouts">
        <div className="section-heading"><h2 id="recent-workouts">Recent workouts</h2><Link href="/training">All workouts <span aria-hidden="true">↗</span></Link></div>
        <WorkoutList workouts={workouts} />
      </section>
      <section aria-labelledby="latest-journal">
        <div className="section-heading"><h2 id="latest-journal">Journal</h2><Link href="/journal">All entries <span aria-hidden="true">↗</span></Link></div>
        {post ? <article className="journal-teaser">
          {post.photo && <img src={`/api/photos/${post.photo}`} alt="" loading="lazy" />}
          <div>
            <time className="eyebrow" dateTime={post.day}>{displayDay(post.day)}</time>
            <h3><Link href={`/journal/${post.id}`}>{post.title}</Link></h3>
            <p>{post.excerpt}</p>
          </div>
        </article> : <p className="empty">Published entries will appear here.</p>}
      </section>
    </div>
  </>;
}
