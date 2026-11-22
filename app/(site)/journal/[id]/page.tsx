import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dateLabel } from "@/src/lib/day-format";
import { publicJournalPost } from "@/src/lib/public-data";
import { isId, stockholmDay } from "@/src/lib/workout-doc";
import { Opener, TextRow } from "../../_parts/opener";
import styles from "../../public.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = isId(id) ? await publicJournalPost(id) : null;
  return { title: post?.title ?? "Journal entry" };
}

export default async function JournalEntry({ params }: Props) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const post = await publicJournalPost(id);
  if (!post) notFound();
  return <>
    <Opener margin={<time dateTime={post.day}>{dateLabel(post.day, stockholmDay().slice(0, 4))}</time>}>
      <h1>{post.title}</h1>
    </Opener>
    <TextRow><div className="prose prose--pre">{post.body}</div></TextRow>
    {post.photos.map((photo) => (
      <TextRow key={photo.id}>
        <img className={styles.photo} src={`/api/photos/${photo.id}`} alt={photo.alt} loading="lazy" />
      </TextRow>
    ))}
  </>;
}
