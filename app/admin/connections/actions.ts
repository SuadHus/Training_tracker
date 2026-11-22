"use server";

import { redirect } from "next/navigation";

import { beginHealthOAuth } from "@/src/lib/health-oauth";
import { providerName } from "@/src/lib/health-providers";
import { disconnectHealthProvider, syncHealthProvider } from "@/src/lib/health-sync";
import { requireOwner } from "@/src/lib/owner";

function submittedProvider(formData: FormData) {
  const value = formData.get("provider");
  const provider = typeof value === "string" ? providerName(value) : null;
  if (!provider) redirect("/admin/connections");
  return provider;
}

export async function connectSource(formData: FormData) {
  await requireOwner();
  const provider = submittedProvider(formData);
  let destination: URL;
  try {
    destination = await beginHealthOAuth(provider);
  } catch {
    redirect("/admin/connections?result=connect-failed");
  }
  redirect(destination.toString());
}

export async function syncSource(formData: FormData) {
  await requireOwner();
  const provider = submittedProvider(formData);
  const result = await syncHealthProvider(provider, { force: provider === "withings" });
  const params = new URLSearchParams({ result: result.outcome });
  if (result.count !== undefined) params.set("count", String(result.count));
  redirect(`/admin/connections?${params}`);
}

export async function disconnectSource(formData: FormData) {
  await requireOwner();
  const provider = submittedProvider(formData);
  try {
    await disconnectHealthProvider(provider);
  } catch {
    redirect("/admin/connections?result=disconnect-failed");
  }
  redirect("/admin/connections?result=disconnected");
}
