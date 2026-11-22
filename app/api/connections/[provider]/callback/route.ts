import { NextResponse } from "next/server";

import { finishHealthOAuth } from "@/src/lib/health-oauth";
import { providerName, providerOptions } from "@/src/lib/health-providers";
import { connectHealthProvider } from "@/src/lib/health-sync";
import { isOwner } from "@/src/lib/owner";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerName((await params).provider);
  if (!provider) return new NextResponse(null, { status: 404 });
  const input = new URL(request.url).searchParams;
  if (provider === "withings" && input.size === 0) return new NextResponse(null, { status: 204 });
  const callback = providerOptions(provider)?.callback;
  const origin = callback ?? process.env.APP_URL ?? request.url;
  if (!(await isOwner())) return NextResponse.redirect(new URL("/login", origin));
  const target = new URL("/admin/connections", origin);
  const verifier = await finishHealthOAuth(provider, input.get("state"));
  const code = input.get("code");

  let outcome = "connect-failed";
  if (verifier && code && !input.has("error")) {
    try {
      await connectHealthProvider(provider, code, verifier);
      outcome = "connected";
    } catch {
      // Return only the local status. The callback's codes and provider response stay private.
    }
  }

  target.searchParams.set("result", outcome);
  return NextResponse.redirect(target, { headers: { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return new NextResponse(null, { status: (await params).provider === "withings" ? 204 : 404 });
}
