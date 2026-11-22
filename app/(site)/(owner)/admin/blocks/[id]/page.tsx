import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/app/ui/submit-button";
import {
  addBlockSessionAction, addBlockWeekAction, deleteBlockAction, removeBlockWeekAction, renameBlockAction,
} from "@/src/actions/training";
import { blockLimits, loadBlock, weekOfBlock, type BlockLine, type BlockSession } from "@/src/lib/block-store";
import { dateLabel, dayShort, weekRange } from "@/src/lib/day-format";
import { requireOwner } from "@/src/lib/owner";
import { rowLabel } from "@/src/lib/sheet-import";
import { addDays, stockholmDay } from "@/src/lib/workout-doc";
import { deskData } from "@/src/lib/workout-store";
import { ConfirmForm } from "../../../confirm-form";
import styles from "../../../owner.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireOwner();
  const block = await loadBlock((await params).id);
  return { title: block?.title ?? "Block", robots: { index: false, follow: false } };
}

function status(session: BlockSession, today: string): { label: string; className: string } | null {
  if (session.status === "completed") return { label: "Done", className: "tag tag--solid" };
  if (session.loggedCount > 0) return { label: "In progress", className: `tag ${styles.tagNow}` };
  if (session.day < today) return { label: "Missed", className: "tag" };
  if (session.day === today) return { label: "Today", className: `tag ${styles.tagNow}` };
  return null;
}

function Line({ line, finished }: { line: BlockLine; finished: boolean }) {
  const planned = line.planned.map((row) => rowLabel(row, line.tracking)).join("; ");
  const done = line.done.map((row) => rowLabel(row, line.tracking)).join("; ");
  return (
    <li>
      <span className={styles.lineName}>{line.exercise}</span>
      {finished && done ? (
        <>
          <span className={styles.lineDone}>{done}</span>
          {planned !== done && <span className={styles.linePlan}><span className="sr">Planned: </span>{planned}</span>}
        </>
      ) : <span className={styles.lineDone}>{planned}</span>}
    </li>
  );
}

export default async function Block({ params, searchParams }: Props) {
  await requireOwner();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const [block, { templates }] = await Promise.all([loadBlock(id), deskData()]);
  if (!block) notFound();
  const today = stockholmDay();
  const current = weekOfBlock(block, today);
  const end = addDays(block.startDay, block.weeks * 7 - 1);

  return (
    <>
      <div className="row opener row--stack">
        <div className="row-margin">
          {block.weeks} {block.weeks === 1 ? "week" : "weeks"}
          <small>{dateLabel(block.startDay)}–{dateLabel(end)}</small>
        </div>
        <div>
          <h1>{block.title}</h1>
          {block.notes && <p className={`prose prose--pre ${styles.lede}`}>{block.notes}</p>}
          <nav className={styles.weekNav} aria-label="Weeks of this block">
            {block.weekList.map(({ week }) => (
              <a key={week} href={`#week-${week}`} aria-current={week === current ? "true" : undefined}>Week {week}</a>
            ))}
          </nav>
        </div>
      </div>

      {error && <div className="row row--flush row--stack"><div /><p className="notice notice--alert" role="alert">{error}</p></div>}

      {block.weekList.map(({ week, start, sessions }) => (
        <section className="row row--section row--stack" id={`week-${week}`} key={week} aria-labelledby={`week-${week}-h`}>
          <h2 className="row-margin" id={`week-${week}-h`}>
            {week === current ? <span className={styles.nowMark}>Week {week}</span> : <>Week {week}</>}
            <small>{weekRange(start)}</small>
          </h2>
          {sessions.length === 0 ? <p className="empty-line">No sessions in this week.</p> : (
            <ul className={styles.weekGrid}>
              {sessions.map((session) => {
                const mark = status(session, today);
                return (
                  <li key={session.id} className={styles.sessionCell}>
                    <p className={styles.cellDay}>{dayShort(session.day)}{mark && <> <span className={mark.className}>{mark.label}</span></>}</p>
                    <p className={styles.title}><Link href={`/admin/workouts/${session.id}`}>{session.title}</Link></p>
                    {session.lines.length > 0
                      ? <ul className={styles.cellLines}>{session.lines.map((line, at) => <Line key={at} line={line} finished={session.status === "completed"} />)}</ul>
                      : <p className={`${styles.names} light`}>No exercises yet</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <div className="row row--section row--stack">
        <h2 className="row-margin">Change</h2>
        <div className={styles.blockTools}>
          {block.weeks < blockLimits.weeks && (
            <form action={addBlockWeekAction} className={styles.plan}>
              <input type="hidden" name="block_id" value={block.id} />
              <div>
                <label className="label" htmlFor="add-kg">Add to every load <span className="hint">kg</span></label>
                <input id="add-kg" className="field" inputMode="decimal" name="add_kg" defaultValue="0" autoComplete="off" />
              </div>
              <SubmitButton pending="Adding">{`Add week ${block.weeks + 1}`}</SubmitButton>
              <p className={`${styles.full} hint`}>Repeats week {block.weeks} a week later. Change single sessions by opening them.</p>
            </form>
          )}
          <form action={addBlockSessionAction} className={styles.plan}>
            <input type="hidden" name="block_id" value={block.id} />
            <div>
              <label className="label" htmlFor="session-day">Day</label>
              <input id="session-day" className="field" type="date" name="day" min={block.startDay} max={end} defaultValue={current ? today : block.startDay} required />
            </div>
            <div>
              <label className="label" htmlFor="session-template">Template</label>
              <select id="session-template" className="select" name="template_id" defaultValue="">
                <option value="">Empty session</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
              </select>
            </div>
            <SubmitButton pending="Adding">Add session</SubmitButton>
            <p className={`${styles.full} hint`}>The day decides which week the session lands in.</p>
          </form>
          <details className={styles.more}>
            <summary>Rename or add notes</summary>
            <form action={renameBlockAction} className="form">
              <input type="hidden" name="block_id" value={block.id} />
              <div>
                <label className="label" htmlFor="block-name">Name</label>
                <input id="block-name" className="field" name="title" maxLength={120} defaultValue={block.title} required autoComplete="off" />
              </div>
              <div>
                <label className="label" htmlFor="block-notes">Notes <span className="hint">only you see these</span></label>
                <textarea id="block-notes" className="textarea" name="notes" maxLength={4000} defaultValue={block.notes} />
              </div>
              <div className="form-actions"><SubmitButton pending="Saving">Save block</SubmitButton></div>
            </form>
          </details>
          <div className={styles.blockEnds}>
            {block.weeks > 1 && (
              <ConfirmForm
                action={removeBlockWeekAction} label={`Remove week ${block.weeks}`} subject={`from ${block.title}`}
                confirmLabel={`Remove week ${block.weeks}`} keepLabel="Keep week"
              >
                <input type="hidden" name="block_id" value={block.id} />
              </ConfirmForm>
            )}
            <ConfirmForm action={deleteBlockAction} label="Delete block" subject={block.title} confirmLabel="Delete block" keepLabel="Keep block">
              <input type="hidden" name="block_id" value={block.id} />
            </ConfirmForm>
          </div>
          <p className="hint">Removing a week or the block deletes the sessions in it that were never started. Sessions you trained stay in the log.</p>
        </div>
      </div>
    </>
  );
}
