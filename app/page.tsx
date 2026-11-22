import Link from "next/link";
import { publicProgress, publicJournal, publicWorkouts } from "@/src/lib/public-data";
import { displayDay, numberLabel } from "@/src/lib/training-public";
import { WorkoutList } from "./workout-list";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [workouts, posts, progress] = await Promise.all([publicWorkouts(5), publicJournal(1), publicProgress()]);
  const week = progress.weeks.at(-1);
  const peak = Math.max(1, ...progress.weeks.map(({ tonnage }) => tonnage));
  return <>
    <section className="home-intro">
      <div className="intro">
        <h1>Training<br />log.</h1>
        <p className="lede">Strength training, progress, and notes from the process.</p>
      </div>
      <div className="week-panel">
        <p className="eyebrow">Work-set volume this week</p>
        <p className="week-number">{numberLabel.format(week?.tonnage ?? 0)} <span>kg</span></p>
        <ol aria-label="Last six weeks of training volume" className="week-bars">
          {progress.weeks.map(({ day, tonnage }, index) => <li key={day} className={index === progress.weeks.length - 1 ? "current" : undefined}>
            <span className="bar-track" aria-hidden="true"><i style={{ height: `${tonnage / peak * 100}%` }} /></span>
            <time dateTime={day}>{displayDay(day).split(" ").slice(0, 2).join(" ")}</time>
            <span className="sr-only">{numberLabel.format(tonnage)} kilograms</span>
          </li>)}
        </ol>
      </div>
    </section>
    <div className="home-grid">
      <section>
        <div className="section-heading"><h2>Recent workouts</h2><Link href="/training">History ↗</Link></div>
        <WorkoutList workouts={workouts} />
      </section>
      <section>
        <div className="section-heading"><h2>Journal</h2><Link href="/journal">All posts ↗</Link></div>
        {posts.length ? posts.map((post) => <article className="journal-teaser" key={post.id}>
          <time className="eyebrow" dateTime={post.day}>{displayDay(post.day)}</time>
          <h3><Link href={`/journal/${post.id}`}>{post.title}</Link></h3>
          <p>{post.excerpt}</p>
        </article>) : <p className="empty">Published entries will appear here.</p>}
      </section>
    </div>
  </>;
}
