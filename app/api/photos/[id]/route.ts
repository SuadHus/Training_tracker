import { query } from "@/src/lib/db";
import { isOwner } from "@/src/lib/owner";
import { validId } from "@/src/lib/training-public";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return new Response(null, { status: 404 });
  const owner = await isOwner();
  const { rows: [photo] } = await query<{ image: Buffer }>(
    `SELECT p.image FROM journal_photos p JOIN journal_posts j ON j.id = p.post_id
     WHERE p.id = $1 AND ($2::boolean OR j.published_at <= now())`, [id, owner],
  );
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.image), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
