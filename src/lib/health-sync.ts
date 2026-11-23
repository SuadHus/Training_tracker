import { query, transaction } from "./db";
import { hasHealthKey, openHealthValue, sealHealthValue } from "./health-crypto";
import { healthAutoSyncCooldownMs, healthDay, healthSyncRange, shouldAutoSync } from "./health-normalize";
import {
  expectedHealthMetrics, healthProviders, providerName, providerObservations, providerOptions, HealthProviderError,
  type HealthCredentials, type HealthProvider,
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
  autoSyncState().lastAttemptAt.delete(provider);
}

export async function disconnectHealthProvider(provider: HealthProvider) {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`health-provider:${provider}`]);
    await client.query("DELETE FROM source_connections WHERE provider = $1", [provider]);
    await client.query("DELETE FROM health_observations WHERE provider = $1", [provider]);
  });
  autoSyncState().lastAttemptAt.delete(provider);
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

export async function syncHealthProvider(provider: HealthProvider, { force = false } = {}): Promise<HealthSyncResult> {
  try {
    let active = await accessCredentials(provider);
    if (!active) return { provider, outcome: "inactive" };
    const range = healthSyncRange(new Date(), Boolean(active.credentials.lastSyncedAt), force);
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

type AutoSyncState = {
  inFlight: Map<HealthProvider, Promise<HealthSyncResult>>;
  lastAttemptAt: Map<HealthProvider, number>;
};

const syncGlobal = globalThis as typeof globalThis & { healthAutoSync?: AutoSyncState };

function autoSyncState(): AutoSyncState {
  if (!syncGlobal.healthAutoSync) {
    syncGlobal.healthAutoSync = { inFlight: new Map(), lastAttemptAt: new Map() };
  }
  return syncGlobal.healthAutoSync;
}

export async function syncStaleHealthProviders(now = new Date()): Promise<HealthSyncResult[]> {
  if (!hasHealthKey()) return [];
  try {
    const state = autoSyncState();
    const { rows } = await query<{ provider: string; credentials: string }>(
      "SELECT provider, credentials FROM source_connections",
    );
    if (!rows.length) return [];

    const tasks: Array<Promise<HealthSyncResult>> = [];
    const candidates: Array<{ provider: HealthProvider; credentials: HealthCredentials }> = [];

    for (const row of rows) {
      const provider = providerName(row.provider);
      if (!provider || !providerOptions(provider)) continue;
      const running = state.inFlight.get(provider);
      if (running) {
        tasks.push(running);
        continue;
      }
      const lastAttempt = state.lastAttemptAt.get(provider);
      if (lastAttempt !== undefined && now.getTime() - lastAttempt < healthAutoSyncCooldownMs) continue;
      try {
        candidates.push({ provider, credentials: readCredentials(provider, row.credentials) });
      } catch {
        // Credentials sealed with an old key require manual reconnection.
      }
    }

    if (candidates.length > 0) {
      const today = healthDay(now);
      const { rows: observed } = await query<{ provider: string; metric: string }>(
        "SELECT provider, metric FROM health_observations WHERE local_day = $1",
        [today],
      );
      const todayMetrics = new Set(observed.map((item) => `${item.provider}:${item.metric}`));

      for (const { provider, credentials } of candidates) {
        const expected = expectedHealthMetrics(provider, credentials.scopes);
        const hasTodayData = expected.length > 0 && expected.every((metric) => todayMetrics.has(`${provider}:${metric}`));
        if (!shouldAutoSync({ provider, lastSyncedAt: credentials.lastSyncedAt, hasTodayData, now })) continue;

        state.lastAttemptAt.set(provider, now.getTime());
        const task = syncHealthProvider(provider).finally(() => {
          if (state.inFlight.get(provider) === task) state.inFlight.delete(provider);
        });
        state.inFlight.set(provider, task);
        tasks.push(task);
      }
    }

    return tasks.length ? await Promise.all(tasks) : [];
  } catch {
    return [];
  }
}
