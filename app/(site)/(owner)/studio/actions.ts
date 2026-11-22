"use server";

import { redirect } from "next/navigation";
import sharp from "sharp";
import { query } from "@/src/lib/db";
import { requireOwner } from "@/src/lib/owner";
import { isDay, isId } from "@/src/lib/workout-doc";

function input(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveVitals(form: FormData) {
  await requireOwner();
  const day = input(form, "day");
  if (!isDay(day)) redirect("/studio?error=day");
  const fields = [
    ["resting_heart_rate", 1, 300],
    ["sleep_minutes", 0, 1440],
    ["sleep_score", 0, 100],
  ] as const;
  const values = fields.map(([name, min, max]) => {
    const raw = input(form, name);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || !Number.isInteger(value)) {
      redirect(`/studio?day=${day}&error=vitals`);
    }
    return value;
  });
  await query(
    `INSERT INTO published_daily_vitals (local_day, resting_heart_rate, sleep_minutes, sleep_score)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (local_day) DO UPDATE SET resting_heart_rate = excluded.resting_heart_rate,
        sleep_minutes = excluded.sleep_minutes, sleep_score = excluded.sleep_score`,
    [day, ...values],
  );
  redirect(`/studio?day=${day}&saved=1`);
}

export async function createPost(form: FormData) {
  await requireOwner();
  const title = input(form, "title");
  if (!title || title.length > 150) redirect("/studio?error=title");
  const { rows: [post] } = await query<{ id: string }>(
    "INSERT INTO journal_posts (title, body) VALUES ($1, '') RETURNING id", [title],
  );
  redirect(`/studio/journal/${post.id}`);
}

export async function savePost(id: string, form: FormData) {
  await requireOwner();
  if (!isId(id)) redirect("/studio");
  const title = input(form, "title");
  const body = input(form, "body");
  const action = input(form, "mode");
  const path = `/studio/journal/${id}`;
  if (!title || title.length > 150 || body.length > 40000) redirect(`${path}?error=post`);
  if (action === "publish" && !body) redirect(`${path}?error=body`);
  await query(
    `UPDATE journal_posts SET title = $2, body = $3, updated_at = now(),
      published_at = CASE $4::text WHEN 'publish' THEN coalesce(published_at, now())
        WHEN 'unpublish' THEN NULL ELSE published_at END WHERE id = $1`,
    [id, title, body, action],
  );
  redirect(`${path}?saved=1`);
}

export async function addPhoto(id: string, form: FormData) {
  await requireOwner();
  if (!isId(id)) redirect("/studio");
  const path = `/studio/journal/${id}`;
  const file = form.get("photo");
  const alt = input(form, "alt");
  if (!(file instanceof File) || file.size === 0 || file.size > 8 * 1024 * 1024 || !alt || alt.length > 240) {
    redirect(`${path}?error=photo`);
  }
  let image: Buffer;
  try {
    const original = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 60_000_000 });
    const { format } = await original.metadata();
    if (!format || !["jpeg", "png", "webp", "heif", "avif"].includes(format)) throw new Error("Unsupported image");
    image = await original.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  } catch {
    redirect(`${path}?error=photo`);
  }
  await query("INSERT INTO journal_photos (post_id, alt, image) SELECT id, $2, $3 FROM journal_posts WHERE id = $1", [id, alt, image]);
  redirect(`${path}?saved=1`);
}

export async function removePhoto(id: string, form: FormData) {
  await requireOwner();
  const photo = input(form, "photo");
  if (!isId(id) || !isId(photo)) redirect("/studio");
  await query("DELETE FROM journal_photos WHERE id = $1 AND post_id = $2", [photo, id]);
  redirect(`/studio/journal/${id}?saved=1`);
}
