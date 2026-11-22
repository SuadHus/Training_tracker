import { query, transaction } from "./db";
import { hasHealthKey, openHealthValue, sealHealthValue } from "./health-crypto";
import { healthDay, shiftHealthDay } from "./health-normalize";
import {
  healthProviders, providerObservations, providerOptions, HealthProviderError, type HealthCredentials, type HealthProvider,
} from "./health-providers";

type ConnectionRow = { provider: HealthProvider; credentials: string };
export type HealthSyncResult = { provider: HealthProvider; outcome: "synced" | "busy" | "inactive" | "failed"; count?: number };

function readCredentials(provider: HealthProvider, value: string) {
  return openHealthValue<HealthCredentials>(value, `health-token:${provider}`);
}

function writeCredentials(provider: HealthProvider, credentials: HealthCredentials) {
  return sealHealthValue(credentials, `health-token:${provider}`);
}

export async function healthStatuses() {
  const result = await query<ConnectionRow>("SELECT provider, credentials FROM source_connections");
  return (Object.keys(healthProviders) as HealthProvider[]).map((provider) => {
    const row = result.rows.find((entry) => entry.provider === provider);
    const configured = hasHealthKey() && !!providerOptions(provider);
    let lastSyncedAt: string | undefined;
    if (row && configured) {
      try {
        lastSyncedAt = readCredentials(provider, row.credentials).lastSyncedAt;
      } catch {
        return { provider, connected: true, configured, reauthorize: true };
      }
    }
    return { provider, configured, connected: !!row, lastSyncedAt };
  });
}

export async function connectHealthProvider(provider: HealthProvider, code: string, verifier: string) {
  const options = providerOptions(provider);
  if (!options || !hasHealthKey()) throw new Error("Health provider is not configured.");
  const credentials = await healthProviders[provider].exchange(options, code, verifier);
  if (!credentials.scopes.some((scope) => provider === "withings" ? scope === "user.metrics" : scope.startsWith("https://www.googleapis.com/auth/googlehealth."))) {
    throw new Error("Required read access was not granted.");
  }

  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`health-provider:${provider}`]);
    const current = await client.query<ConnectionRow>("SELECT credentials FROM source_connections WHERE provider = $1", [provider]);
    const previous = current.rows[0];
    let sameConsent = false;
    if (previous) {
      try {
        const existing = readCredentials(provider, previous.credentials);
        sameConsent = existing.accountId === credentials.accountId
          && existing.scopes.every((scope) => credentials.scopes.includes(scope));
      } catch {
        // A replaced key requires fresh credentials and fresh imports.
      }
    }
    if (!sameConsent) await client.query("DELETE FROM health_observations WHERE provider = $1", [provider]);
    await client.query(
      `INSERT INTO source_connections (provider, credentials) VALUES ($1, $2)
       ON CONFLICT (provider) DO UPDATE SET credentials = EXCLUDED.credentials, updated_at = now()`,
      [provider, writeCredentials(provider, credentials)],
    );
  });
}

export async function disconnectHealthProvider(provider: HealthProvider) {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`health-provider:${provider}`]);
    await client.query("DELETE FROM source_connections WHERE provider = $1", [provider]);
    await client.query("DELETE FROM health_observations WHERE provider = $1", [provider]);
  });
}

async function accessCredentials(provider: HealthProvider, rejectedToken?: string) {
  const options = providerOptions(provider);
  if (!options || !hasHealthKey()) return null;
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`health-provider:${provider}`]);
    const result = await client.query<ConnectionRow>("SELECT credentials FROM source_connections WHERE provider = $1", [provider]);
    const row = result.rows[0];
    if (!row) return null;
    let version = row.credentials;
    let credentials = readCredentials(provider, version);
    if (credentials.expiresAt < Date.now() + 60_000 || credentials.accessToken === rejectedToken) {
      credentials = await healthProviders[provider].refresh(options, credentials);
      version = writeCredentials(provider, credentials);
      await client.query("UPDATE source_connections SET credentials = $2, updated_at = now() WHERE provider = $1", [provider, version]);
    }
    return { credentials, version };
  });
}

export async function syncHealthProvider(provider: HealthProvider): Promise<HealthSyncResult> {
  try {
    let active = await accessCredentials(provider);
    if (!active) return { provider, outcome: "inactive" };
    const today = healthDay(new Date());
    const range = { from: shiftHealthDay(today, active.credentials.lastSyncedAt ? -13 : -29), end: shiftHealthDay(today, 1) };
    let observations;
    try {
      observations = await providerObservations(provider, active.credentials, range);
    } catch (error) {
      if (!(error instanceof HealthProviderError) || error.status !== 401) throw error;
      const refreshed = await accessCredentials(provider, active.credentials.accessToken);
      if (!refreshed || refreshed.credentials.accountId !== active.credentials.accountId) return { provider, outcome: "busy" };
      active = refreshed;
      observations = await providerObservations(provider, active.credentials, range);
    }
    const { credentials, version } = active;
    const synced = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`health-provider:${provider}`]);
      const updated = await client.query(
        "UPDATE source_connections SET credentials = $3, updated_at = now() WHERE provider = $1 AND credentials = $2",
        [provider, version, writeCredentials(provider, { ...credentials, lastSyncedAt: new Date().toISOString() })],
      );
      if (!updated.rowCount) return false;

      // Replace the provider snapshot for the window, including readings removed upstream.
      await client.query("DELETE FROM health_observations WHERE provider = $1 AND local_day >= $2 AND local_day < $3", [
        provider, range.from, range.end,
      ]);
      await client.query(
        `INSERT INTO health_observations (provider, external_id, metric, local_day, observed_at, value)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::date[], $5::timestamptz[], $6::numeric[])`,
        [
          provider,
          observations.map((item) => item.externalId),
          observations.map((item) => item.metric),
          observations.map((item) => item.localDay),
          observations.map((item) => item.observedAt),
          observations.map((item) => item.value),
        ],
      );
      return true;
    });
    return synced ? { provider, outcome: "synced", count: observations.length } : { provider, outcome: "busy" };
  } catch {
    return { provider, outcome: "failed" };
  }
}
