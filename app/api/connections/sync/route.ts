import { healthSecretMatches } from "@/src/lib/health-crypto";
import { healthProviders, type HealthProvider } from "@/src/lib/health-providers";
import { syncHealthProvider } from "@/src/lib/health-sync";

export async function POST(request: Request) {
  const secret = process.env.HEALTH_SYNC_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied || !healthSecretMatches(`Bearer ${secret}`, supplied)) {
    return new Response(null, { status: 401 });
  }

  const providers = Object.keys(healthProviders) as HealthProvider[];
  const results = await Promise.all(providers.map((provider) => syncHealthProvider(provider)));
  return Response.json({ results }, {
    status: results.some((result) => result.outcome === "failed") ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
