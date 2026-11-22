import Link from "next/link";
import { dateLabel } from "@/src/lib/day-format";
import { publicJournal } from "@/src/lib/public-data";
import { stockholmDay } from "@/src/lib/workout-doc";
import { excerptOf } from "../_parts/format";
import { Opener, TextRow } from "../_parts/opener";
import styles from "../public.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal" };

export default async function Journal() {
  const posts = await publicJournal();
  const year = stockholmDay().slice(0, 4);
  return <>
    <Opener><h1>Journal</h1></Opener>
    {posts.length === 0 && <TextRow><p className="empty-line">No entries yet.</p></TextRow>}
    {posts.map((post, index) => (
      <div className={index === 0 ? "row row--flush" : "row"} key={post.id}>
        <div className="row-margin"><time dateTime={post.day}>{dateLabel(post.day, year)}</time></div>
        <div className={styles.entry}>
          <div>
            <h2 className={styles.journalTitle}><Link href={`/journal/${post.id}`}>{post.title}</Link></h2>
            <p className="prose">{excerptOf(post.excerpt)}</p>
          </div>
          {post.photo && <img className={styles.thumb} src={`/api/photos/${post.photo}`} alt="" loading="lazy" />}
        </div>
      </div>
    ))}
  </>;
}
