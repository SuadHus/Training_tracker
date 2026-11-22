import { randomUUID } from "node:crypto";
import Link from "next/link";
import { deleteWorkoutAction, startWorkoutAction } from "@/src/actions/training";
import { SubmitButton } from "@/app/ui/submit-button";
import { clockTime, dayLabel, weekLabel, weekName, weekRange } from "@/src/lib/day-format";
import { requireOwner } from "@/src/lib/owner";
import { addDays, weekStart } from "@/src/lib/workout-doc";
import { deskData, type DeskWorkout } from "@/src/lib/workout-store";
import { ConfirmForm } from "../confirm-form";
import styles from "../owner.module.css";
import { exerciseNames, StartTemplate } from "../start-form";
import { PlanForm } from "./plan-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Desk", robots: { index: false, follow: false } };

const sets = (count: number) => `${count} ${count === 1 ? "set" : "sets"}`;
const names = (workout: DeskWorkout) => exerciseNames(workout.exercises, workout.exerciseCount);

function DeleteSession({ id, subject }: { id: string; subject: string }) {
  return (
    <ConfirmForm action={deleteWorkoutAction} label="Delete" subject={subject} confirmLabel="Delete session" keepLabel="Keep session">
      <input type="hidden" name="workout_id" value={id} />
    </ConfirmForm>
  );
}

export default async function Desk({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error } = await searchParams;
  const desk = await deskData();
  const { today } = desk;
  const monday = weekStart(today);
  const nothingToday = desk.inProgress.length === 0 && desk.todayPlanned.length === 0;

  return (
    <>
      <div className="row opener row--stack">
        <div className="row-margin">
          <span className="week-no"><span aria-hidden="true">{weekLabel(today)}</span><span className="sr">{weekName(today)}</span></span>
          <small>{weekRange(monday)}</small>
        </div>
        <h1>{dayLabel(today)}</h1>
      </div>

      {error && <div className="row row--flush row--stack"><div /><p className="notice notice--alert" role="alert">{error}</p></div>}

      {desk.inProgress.length > 0 && (
        <div className="row row--stack">
          <h2 className="row-margin">Now</h2>
          <ul className={styles.list}>
            {desk.inProgress.map((workout) => (
              <li key={workout.id} className={`${styles.item} ${styles.now}`}>
                <div className={styles.main}>
                  <span className={styles.title}>{workout.title}</span>
                  <span className={styles.names}>{workout.loggedCount} of {workout.setCount} sets logged</span>
                </div>
                <div className={styles.actions}><Link className="btn" href={`/admin/workouts/${workout.id}`}>Resume</Link></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(desk.todayPlanned.length > 0 || nothingToday) && (
        <div className="row row--stack">
          <h2 className="row-margin">Today</h2>
          {nothingToday ? <p className="empty-line">Nothing planned for today.</p> : (
            <ul className={styles.list}>
              {desk.todayPlanned.map((workout) => (
                <li key={workout.id} className={styles.item}>
                  <div className={styles.main}>
                    <span className={styles.title}>{workout.title}</span>
                    <span className={styles.names}>{names(workout)}</span>
                    <span className={`${styles.names} light`}>Planned {clockTime(workout.createdAt)}</span>
                  </div>
                  <div className={styles.actions}>
                    <Link className="btn" href={`/admin/workouts/${workout.id}`}>Open<span className="sr"> {workout.title}</span></Link>
                    <DeleteSession id={workout.id} subject={`${workout.title}, today`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="row row--section row--stack">
        <h2 className="row-margin">Start</h2>
        <div>
          {desk.templates.length > 0 ? (
            <ul className={styles.list}>
              {desk.templates.map((template) => (
                <li key={template.id} className={styles.item}>
                  <div className={styles.main}>
                    <span className={styles.title}>{template.title}</span>
                    <span className={styles.names}>{exerciseNames(template.exercises, template.exerciseCount)}</span>
                    <span className={`${styles.names} light`}>{template.lastUsed ? `Last used ${dayLabel(template.lastUsed)}` : "Not used yet"}</span>
                  </div>
                  <div className={styles.actions}>
                    <StartTemplate templateId={template.id} />
                    <Link className="btn btn--quiet" href={`/admin/workouts/${template.id}`}>Edit<span className="sr"> {template.title}</span></Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-line">No templates yet. A template is a workout you repeat: build one and start it in one tap. <Link href="/admin/templates">New template</Link></p>
          )}
          <div className={styles.after}>
            <form action={startWorkoutAction}>
              <input type="hidden" name="id" value={randomUUID()} />
              <input type="hidden" name="kind" value="planned" />
              <input type="hidden" name="title" value="Session" />
              <input type="hidden" name="when" value="today" />
              <SubmitButton className="btn btn--plain" pending="Starting">Start a blank session</SubmitButton>
            </form>
            {desk.templates.length > 0 && <Link className={styles.plainLink} href="/admin/templates">New template</Link>}
          </div>
        </div>
      </div>

      <div className="row row--section row--stack">
        <h2 className="row-margin">Planned</h2>
        <div>
          {desk.overdue.length + desk.upcoming.length > 0 && (
            <ul className={styles.list}>
              {[...desk.upcoming.map((workout) => ({ workout, missed: false })), ...desk.overdue.map((workout) => ({ workout, missed: true }))].map(({ workout, missed }) => (
                <li key={workout.id} className={`${styles.item} ${styles.itemDated}`}>
                  <span className={styles.date}>{dayLabel(workout.day)}</span>
                  <div className={styles.main}>
                    <span className={styles.title}>{workout.title}{missed && <> <span className="tag">Missed</span></>}</span>
                    <span className={styles.names}>{names(workout)}</span>
                  </div>
                  <div className={styles.actions}>
                    <Link className="btn btn--quiet" href={`/admin/workouts/${workout.id}`}>Open<span className="sr"> {workout.title}, {dayLabel(workout.day)}</span></Link>
                    {missed && <DeleteSession id={workout.id} subject={`${workout.title}, ${dayLabel(workout.day)}`} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <PlanForm id={randomUUID()} templates={desk.templates.map(({ id, title }) => ({ id, title }))} defaultDay={addDays(today, 1)} />
        </div>
      </div>

      {desk.recent.length > 0 && (
        <div className="row row--section row--stack">
          <h2 className="row-margin">Recent</h2>
          <ul className={styles.list}>
            {desk.recent.map((workout) => (
              <li key={workout.id} className={`${styles.item} ${styles.itemDated}`}>
                <span className={styles.date}>{dayLabel(workout.day)}</span>
                <div className={styles.main}>
                  <span className={styles.title}>{workout.title}</span>
                  <span className={styles.names}>{sets(workout.loggedCount)}</span>
                </div>
                <div className={styles.actions}>
                  <Link className="btn btn--quiet" href={`/admin/workouts/${workout.id}`}>Edit<span className="sr"> {workout.title}, {dayLabel(workout.day)}</span></Link>
                  <Link className="btn btn--quiet" href={`/training/${workout.id}`}>View<span className="sr"> {workout.title}, {dayLabel(workout.day)}</span></Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
