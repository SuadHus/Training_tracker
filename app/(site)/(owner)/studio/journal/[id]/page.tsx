import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/src/lib/owner";
import { query } from "@/src/lib/db";
import { isId } from "@/src/lib/workout-doc";
import { Icon } from "@/app/ui/icons";
import { SubmitButton } from "@/app/ui/submit-button";
import { ConfirmForm } from "../../../confirm-form";
import styles from "../../../owner.module.css";
import { addPhoto, removePhoto, savePost } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit journal entry", robots: { index: false, follow: false } };

export default async function EditPost({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  if (!isId(id)) notFound();
  const [{ rows: [post] }, { rows: photos }, status] = await Promise.all([
    query<{ title: string; body: string; published_at: string | null }>("SELECT title, body, published_at FROM journal_posts WHERE id = $1", [id]),
    query<{ id: string; alt: string }>("SELECT id, alt FROM journal_photos WHERE post_id = $1 ORDER BY created_at, id", [id]),
    searchParams,
  ]);
  if (!post) notFound();
  return <>
    <div className="row opener row--stack">
      <div className="row-margin"><span className={post.published_at ? "tag tag--solid" : "tag"}>{post.published_at ? "Public" : "Draft"}</span></div>
      <h1 className={styles.journalTitle}>{post.title}</h1>
    </div>

    {(status.saved || status.error) && (
      <div className="row row--flush row--stack">
        <div />
        {status.saved && <p className="notice" role="status">Changes saved.</p>}
        {status.error && <p className="notice notice--alert" role="alert">
          {status.error === "photo" ? "Choose a supported photo under 8 MB and enter a short description." :
            status.error === "body" ? "Write an entry before publishing." : "Check the title and article length."}
        </p>}
      </div>
    )}

    <div className="row row--section row--stack">
      <h2 className="row-margin">Journal</h2>
      <div>
        <form action={savePost.bind(null, id)} className={`form ${styles.reading}`}>
          <div>
            <label className="label" htmlFor="post-title">Title</label>
            <input id="post-title" className="field" name="title" defaultValue={post.title} required maxLength={150} />
          </div>
          <div>
            <label className="label" htmlFor="post-body">Article</label>
            <textarea id="post-body" className={`textarea ${styles.article}`} name="body" defaultValue={post.body} rows={16} maxLength={40000} />
          </div>
          <div className="form-actions">
            <SubmitButton name="mode" value={post.published_at ? "publish" : "save"} pending="Saving">{post.published_at ? "Save changes" : "Save draft"}</SubmitButton>
            <SubmitButton className="btn btn--plain" name="mode" value={post.published_at ? "unpublish" : "publish"} pending={post.published_at ? "Unpublishing" : "Publishing"}>{post.published_at ? "Unpublish" : "Publish"}</SubmitButton>
            {post.published_at && <Link href={`/journal/${id}`} className="btn btn--quiet">View published entry</Link>}
          </div>
        </form>
        <details className={styles.preview}>
          <summary>Preview saved text<Icon name="down" small /></summary>
          <p className="prose">{post.body || "The saved entry is empty."}</p>
        </details>
      </div>
    </div>

    <div className="row row--section row--stack">
      <h2 className="row-margin">Photos</h2>
      <div>
        <form action={addPhoto.bind(null, id)} className="form">
          <div>
            <label className="label" htmlFor="photo-file">Photo</label>
            <input id="photo-file" className={`field ${styles.fileInput}`} name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heif,image/heic,image/avif" required />
          </div>
          <div>
            <label className="label" htmlFor="photo-alt">Image description</label>
            <input id="photo-alt" className="field" name="alt" required maxLength={240} autoComplete="off" />
          </div>
          <div className="form-actions"><SubmitButton pending="Uploading">Upload photo</SubmitButton></div>
        </form>
        {photos.length > 0 && (
          <ul className={styles.photos}>
            {photos.map((photo) => <li key={photo.id} className={styles.photo}>
              <img src={`/api/photos/${photo.id}`} alt={photo.alt} loading="lazy" />
              <ConfirmForm action={removePhoto.bind(null, id)} label="Remove photo" subject={photo.alt} confirmLabel="Remove photo" keepLabel="Keep photo">
                <input type="hidden" name="photo" value={photo.id} />
              </ConfirmForm>
            </li>)}
          </ul>
        )}
      </div>
    </div>
  </>;
}
