import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { healthSecretMatches, openHealthValue, sealHealthValue } from "./health-crypto";
import { healthProviders, providerOptions, type HealthProvider } from "./health-providers";

type OAuthAttempt = { state: string; verifier: string; expiresAt: number };

function cookieName(provider: HealthProvider) {
  return `training-health-${provider}`;
}

function cookiePath(provider: HealthProvider) {
  return `/api/connections/${provider}/callback`;
}

export async function beginHealthOAuth(provider: HealthProvider) {
  const options = providerOptions(provider);
  if (!options) throw new Error("Health provider is not configured.");
  const attempt: OAuthAttempt = {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    expiresAt: Date.now() + 600_000,
  };

  const jar = await cookies();
  jar.set(cookieName(provider), sealHealthValue(attempt, `health-oauth:${provider}`), {
    httpOnly: true,
    secure: options.callback.startsWith("https:"),
    sameSite: "lax",
    maxAge: 600,
    path: cookiePath(provider),
  });

  return healthProviders[provider].authorize(options, attempt.state, attempt.verifier);
}

export async function finishHealthOAuth(provider: HealthProvider, receivedState: string | null) {
  const jar = await cookies();
  const name = cookieName(provider);
  const value = jar.get(name)?.value;
  jar.set(name, "", {
    path: cookiePath(provider),
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: providerOptions(provider)?.callback.startsWith("https:"),
  });
  if (!receivedState || !value) return null;

  try {
    const { state, verifier, expiresAt } = openHealthValue<OAuthAttempt>(value, `health-oauth:${provider}`);
    return expiresAt >= Date.now() && healthSecretMatches(state, receivedState) ? verifier : null;
  } catch {
    return null;
  }
}
