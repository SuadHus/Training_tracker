import { isOwner } from "@/src/lib/owner";
import { isId } from "@/src/lib/workout-doc";
import { saveWorkout, type SaveResult } from "@/src/lib/workout-store";

// The logger saves through this plain request and not through a server action: a save
// that hangs on a bad connection can then be given up on and sent again, where server
// actions wait in one queue behind the one that hangs.

const MOST_BYTES = 2_000_000;
const unreadable: SaveResult = { ok: false, reason: "invalid", message: "The request is not readable. Reload the page and try again." };

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Only this site's own pages may save: the request must name its origin, and it must be ours. */
function fromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!fromThisSite(request) || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "forbidden" }, 403);
  }
  if (!(await isOwner())) return json({ error: "signed-out" }, 401);
  const { id } = await params;
  if (!isId(id)) return json({ ok: false, reason: "missing" } satisfies SaveResult);
  if (Number(request.headers.get("content-length") ?? 0) > MOST_BYTES) return json(unreadable);
  const text = await request.text();
  if (text.length > MOST_BYTES) return json(unreadable);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(unreadable);
  }
  if (typeof body !== "object" || body === null) return json(unreadable);
  const { baseRevision, draft } = body as { baseRevision?: unknown; draft?: unknown };
  if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision)) return json(unreadable);
  return json(await saveWorkout(id, baseRevision, draft));
}
