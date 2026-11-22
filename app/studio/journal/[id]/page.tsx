import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/src/lib/owner";
import { query } from "@/src/lib/db";
import { validId } from "@/src/lib/training-public";
import { addPhoto, removePhoto, savePost } from "../../actions";

export const metadata = { title: "Edit journal entry", robots: { index: false, follow: false } };

export default async function EditPost({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  if (!validId(id)) notFound();
  const [{ rows: [post] }, { rows: photos }, status] = await Promise.all([
    query<{ title: string; body: string; published_at: string | null }>("SELECT title, body, published_at FROM journal_posts WHERE id = $1", [id]),
    query<{ id: string; alt: string }>("SELECT id, alt FROM journal_photos WHERE post_id = $1 ORDER BY created_at, id", [id]),
    searchParams,
  ]);
  if (!post) notFound();
  return <>
    <section className="intro">
      <Link href="/studio" className="back-link">← Publishing</Link>
      <p className="eyebrow">{post.published_at ? "Public" : "Draft"}</p>
      <h1>{post.title}</h1>
    </section>
    {status.saved && <p role="status">Changes saved.</p>}
    {status.error && <p role="alert">
      {status.error === "photo" ? "Choose a supported photo under 8 MB and enter a short description." :
        status.error === "body" ? "Write an entry before publishing." : "Check the title and article length."}
    </p>}
    <div className="home-grid">
      <section>
        <div className="section-heading"><h2>Edit entry</h2></div>
        <form action={savePost.bind(null, id)} className="form-stack">
          <label>Title<input name="title" defaultValue={post.title} required maxLength={150} /></label>
          <label>Article<textarea name="body" defaultValue={post.body} rows={12} maxLength={40000} /></label>
          <div className="form-actions">
            <button name="mode" value={post.published_at ? "publish" : "save"}>{post.published_at ? "Save changes" : "Save draft"}</button>
            <button className="secondary" name="mode" value={post.published_at ? "unpublish" : "publish"}>{post.published_at ? "Unpublish" : "Publish"}</button>
          </div>
        </form>
        <details className="post-preview">
          <summary>Preview saved text</summary>
          <h2>{post.title}</h2>
          <p className="prose">{post.body}</p>
        </details>
        {post.published_at && <Link href={`/journal/${id}`}>View published entry ↗</Link>}
      </section>
      <section>
        <div className="section-heading"><h2>Photos</h2></div>
        <form action={addPhoto.bind(null, id)} className="form-stack">
          <label>Photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heif,image/heic,image/avif" required /></label>
          <label>Image description<input name="alt" required maxLength={240} /></label>
          <button type="submit">Upload photo</button>
        </form>
        <ul className="photo-list">
          {photos.map((photo) => <li key={photo.id}>
            <img src={`/api/photos/${photo.id}`} alt={photo.alt} loading="lazy" />
            <form action={removePhoto.bind(null, id)}>
              <input type="hidden" name="photo" value={photo.id} />
              <button className="secondary" type="submit">Remove photo</button>
            </form>
          </li>)}
        </ul>
      </section>
    </div>
  </>;
}
