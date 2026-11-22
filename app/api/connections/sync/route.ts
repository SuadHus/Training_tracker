import { healthSecretMatches } from "@/src/lib/health-crypto";
import { healthProviders, providerName, type HealthProvider } from "@/src/lib/health-providers";
import { syncHealthProvider } from "@/src/lib/health-sync";

export async function POST(request: Request) {
  const secret = process.env.HEALTH_SYNC_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied || !healthSecretMatches(`Bearer ${secret}`, supplied)) {
    return new Response(null, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const selected = params.get("provider");
  const provider = selected === null ? null : providerName(selected);
  if (selected !== null && !provider) return new Response(null, { status: 400 });
  const providers = provider ? [provider] : Object.keys(healthProviders) as HealthProvider[];
  const results = await Promise.all(providers.map((provider) =>
    syncHealthProvider(provider, { force: provider === "withings" && params.get("force") === "1" }),
  ));
  return Response.json({ results }, {
    status: results.some((result) => result.outcome === "failed") ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
