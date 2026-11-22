import Link from "next/link";
import { notFound } from "next/navigation";
import { publicJournalPost } from "@/src/lib/public-data";
import { displayDay, validId } from "@/src/lib/training-public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal entry" };

export default async function JournalEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) notFound();
  const post = await publicJournalPost(id);
  if (!post) notFound();
  return <article className="narrow">
    <header className="intro">
      <Link href="/journal" className="back-link">← Journal</Link>
      <p className="eyebrow"><time dateTime={post.day}>{displayDay(post.day)}</time></p>
      <h1>{post.title}</h1>
    </header>
    <div className="reading-content">
      <p className="prose">{post.body}</p>
      {post.photos.map((photo) => <img key={photo.id} className="article-photo" src={`/api/photos/${photo.id}`} alt={photo.alt} loading="lazy" />)}
    </div>
  </article>;
}
