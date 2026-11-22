import Link from "next/link";
import { blockLimits, listBlocks, weekOfBlock } from "@/src/lib/block-store";
import { dateLabel } from "@/src/lib/day-format";
import { requireOwner } from "@/src/lib/owner";
import { addDays, stockholmDay, weekStart } from "@/src/lib/workout-doc";
import { deskData } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";
import { BlockBuilder } from "./block-builder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blocks", robots: { index: false, follow: false } };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export default async function Blocks({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error } = await searchParams;
  const [blocks, { templates }] = await Promise.all([listBlocks(), deskData()]);
  const today = stockholmDay();
  const nextMonday = addDays(weekStart(today), 7);

  return (
    <>
      <div className="row opener row--stack">
        <div className={styles.full}>
          <h1>Blocks</h1>
          <p className={styles.lede}>
            A block is a run of training weeks. Its sessions are planned on their days, so they turn up on the desk when it is time, and the block shows every week side by side with what was planned and what was done.
          </p>
        </div>
      </div>

      {error && <div className="row row--flush row--stack"><div /><p className="notice notice--alert" role="alert">{error}</p></div>}

      {blocks.length > 0 ? blocks.map((block) => {
        const week = weekOfBlock(block, today);
        const end = addDays(block.startDay, block.weeks * 7 - 1);
        return (
          <div className="row row--stack" key={block.id}>
            <div className="row-margin">
              {week ? <span className={styles.nowMark}>Week {week} of {block.weeks}</span> : block.startDay > today ? "Starts" : "Ended"}
              <small>{dateLabel(block.startDay)}–{dateLabel(end)}</small>
            </div>
            <div className={styles.main}>
              <span className={styles.title}><Link href={`/admin/blocks/${block.id}`}>{block.title}</Link></span>
              <span className={styles.names}>
                {plural(block.weeks, "week", "weeks")}, {plural(block.sessions, "session", "sessions")}, {block.completed} done
              </span>
            </div>
          </div>
        );
      }) : (
        <div className="row row--stack">
          <div className="row-margin" />
          <p className="empty-line">No blocks yet. Build one below from your templates, or paste a whole program from a spreadsheet.</p>
        </div>
      )}

      <div className="row row--section row--stack">
        <h2 className="row-margin">New block</h2>
        {templates.length === 0 ? (
          <p className="empty-line">
            A block is built from templates. <Link href="/admin/templates">Create a template</Link> first, or <Link href="/admin/import?as=block">paste a program from a spreadsheet</Link> and get the whole block at once.
          </p>
        ) : (
          <BlockBuilder templates={templates.map(({ id, title }) => ({ id, title }))} firstDay={nextMonday} mostWeeks={blockLimits.weeks} />
        )}
      </div>
    </>
  );
}
