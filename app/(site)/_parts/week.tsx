import { Fragment } from "react";
import Link from "next/link";
import { BarLoad, perSide } from "@/app/ui/bar-load";
import { Notation, Num } from "@/app/ui/notation";
import { WeekDots } from "@/app/ui/week-strip";
import { dayLabel, dayShort, weekAnchor, weekLabel, weekName, weekRange } from "@/src/lib/day-format";
import { formatSpan, formatTotal, platesPerSide, STANDARD_BAR_KG } from "@/src/lib/workout-doc";
import type { SessionBlock, SessionSummary, WeekSummary } from "@/src/lib/public-data";
import { plural } from "./format";
import { hasValue } from "./sets";
import styles from "../public.module.css";

/** "v. 47", read out as "Week 47". */
export function WeekText({ day }: { day: string }) {
  return <>
    <span aria-hidden="true">{weekLabel(day)}</span>
    <span className="sr">{weekName(day)}</span>
  </>;
}

export function trainedDays(week: WeekSummary): Set<string> {
  return new Set(week.sessions.map((session) => session.day));
}

/** 3 sessions, 33 working sets, 34 250 kg. Numbers bold, the rest soft. */
export function WeekTotals({ week, sofar }: { week: WeekSummary; sofar?: boolean }) {
  const count = week.sessions.length;
  return (
    <p className={styles.totals}>
      <b className="nowrap">{count}</b> {plural(count, "session", "sessions")}
      {week.workSets > 0 && <>, <b>{week.workSets}</b> {plural(week.workSets, "working set", "working sets")}</>}
      {week.volume > 0 && <>, <b className="num nowrap">{formatTotal(week.volume)}&#8201;kg</b></>}
      {sofar && " so far"}
    </p>
  );
}

/** Opens a week in a list of weeks: week number and range in the margin, the days trained and the totals beside. */
export function WeekHeader({ week, sofar }: { week: WeekSummary; sofar?: boolean }) {
  return (
    <div className="row row--section" id={weekAnchor(week.start)}>
      <h2 className="row-margin">
        <span className="week-no"><WeekText day={week.start} /></span>
        <small>{weekRange(week.start)}</small>
      </h2>
      <div className={styles.weekHead}>
        <WeekDots start={week.start} trained={trainedDays(week)} />
        <WeekTotals week={week} sofar={sofar} />
      </div>
    </div>
  );
}

type Drawn = SessionBlock & { top: NonNullable<SessionBlock["top"]> & { load: number } };

function drawable(block: SessionBlock): block is Drawn {
  return block.exercise.equipment === "barbell" && block.top !== null && block.top.load !== null &&
    platesPerSide(block.top.load, block.exercise.barKg ?? STANDARD_BAR_KG) !== null;
}

/** The heaviest drawable barbell working set of a week, ties broken by reps. */
function heaviestSet(week: WeekSummary) {
  let best: { session: SessionSummary; block: Drawn } | null = null;
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      if (!drawable(block)) continue;
      if (!best || block.top.load > best.block.top.load ||
        (block.top.load === best.block.top.load && (block.top.reps ?? 0) > (best.block.top.reps ?? 0))) {
        best = { session, block };
      }
    }
  }
  return best;
}

export function HeaviestBar({ week }: { week: WeekSummary }) {
  const found = heaviestSet(week);
  if (!found) return null;
  const { session, block } = found;
  const bar = block.exercise.barKg;
  return (
    <div className="row row--stack">
      <div className="row-margin">Heaviest bar</div>
      <div>
        <BarLoad load={block.top.load} barKg={bar} size="hero" className={styles.heroWide} />
        <BarLoad load={block.top.load} barKg={bar} size="hero-tight" className={styles.heroTight} />
        <p className={styles.heaviest}>
          <span className="soft">{block.exercise.name}</span>{" "}
          <Notation measures={{ ...block.top, rpe: null }} tracking={block.exercise.tracking} />,{" "}
          {block.top.rpe !== null && <><span className="soft">RPE</span> <b><Num value={block.top.rpe} /></b>, </>}
          {dayLabel(session.day)}, <span className="soft">per side</span>{" "}
          <b>{perSide(block.top.load, bar)}</b>
        </p>
      </div>
    </div>
  );
}

export function SessionRow({ session, today, drawn }: { session: SessionSummary; today?: string; drawn?: SessionBlock }) {
  // The bar already drawn large above the list is not drawn again beside its session.
  const lead = session.blocks.filter((block) => block !== drawn).find(drawable);
  const lines = session.blocks
    .map((block) => ({ block, runs: block.runs.filter((run) => hasValue(run.measures)) }))
    .filter(({ runs }) => runs.length > 0);
  return (
    <div className="row">
      <div className="row-margin">
        {session.day === today ? <span className={styles.today}>{dayShort(session.day)}</span> : dayShort(session.day)}
      </div>
      <div className={styles.session}>
        <div className={styles.sessionHead}>
          <Link href={`/training/${session.id}`} className={`${styles.sessionTitle} ${styles.tapBlock}`}>{session.title}</Link>
          {session.minutes !== null && <span className="light"> {formatSpan(session.minutes)}</span>}
        </div>
        {lead && (
          <div className={styles.sessionBar}>
            <BarLoad load={lead.top.load} barKg={lead.exercise.barKg} size="row" />
          </div>
        )}
        {lines.length > 0 && (
          <ul className={styles.lines}>
            {lines.map(({ block, runs }, index) => (
              <li key={index} className={styles.line}>
                <span className="soft">{block.exercise.name}</span>
                <span className={styles.runs}>
                  {runs.map((run, at) => (
                    <Fragment key={at}>
                      {at > 0 && ", "}
                      <Notation measures={run.measures} tracking={block.exercise.tracking} count={run.count} />
                    </Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A week fully open: its sessions, oldest first, as the week strip reads Monday to Sunday. */
export function WeekSessions({ week, today, underHero = false }: { week: WeekSummary; today?: string; underHero?: boolean }) {
  const drawn = underHero ? heaviestSet(week)?.block : undefined;
  return <>{week.sessions.map((session) => <SessionRow key={session.id} session={session} today={today} drawn={drawn} />)}</>;
}
