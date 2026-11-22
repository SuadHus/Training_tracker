import Link from "next/link";
import { publicJournal } from "@/src/lib/public-data";
import { displayDay } from "@/src/lib/training-public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal" };

export default async function Journal() {
  const posts = await publicJournal();
  return <>
    <section className="intro"><h1>Journal</h1><p className="lede">Notes from the training process.</p></section>
    {posts.length ? <ul className="journal-index">
      {posts.map((post) => <li key={post.id}>
        <Link href={`/journal/${post.id}`}>
          {post.photo && <img src={`/api/photos/${post.photo}`} alt="" loading="lazy" />}
          <div><time className="eyebrow" dateTime={post.day}>{displayDay(post.day)}</time><h2>{post.title}</h2><p>{post.excerpt}</p></div>
          <span aria-hidden="true" className="arrow">↗</span>
        </Link>
      </li>)}
    </ul> : <p className="empty narrow">Published entries will appear here.</p>}
  </>;
}
