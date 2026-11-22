import { NextResponse } from "next/server";

import { finishHealthOAuth } from "@/src/lib/health-oauth";
import { providerName, providerOptions } from "@/src/lib/health-providers";
import { connectHealthProvider } from "@/src/lib/health-sync";
import { isOwner } from "@/src/lib/owner";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerName((await params).provider);
  if (!provider) return new NextResponse(null, { status: 404 });
  if (!(await isOwner())) return NextResponse.redirect(new URL("/login", request.url));

  const callback = providerOptions(provider)?.callback;
  const target = new URL("/admin/connections", callback ?? request.url);
  const input = new URL(request.url).searchParams;
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
