import { createHash } from "node:crypto";

import {
  googleObservations, shiftHealthDay, withingsObservations,
  type GoogleHealthPoint, type HealthObservation, type WithingsMeasureGroup,
} from "./health-normalize";

export type HealthProvider = "google-health" | "withings";
type DayRange = { from: string; end: string };
type OAuthOptions = { clientId: string; clientSecret: string; callback: string };
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  userid?: string | number;
};
export type HealthCredentials = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number;
  scopes: string[];
  lastSyncedAt?: string;
};
type Connector = {
  label: string;
  env: string;
  authorize(options: OAuthOptions, state: string, verifier: string): URL;
  exchange(options: OAuthOptions, code: string, verifier: string): Promise<HealthCredentials>;
  refresh(options: OAuthOptions, credentials: HealthCredentials): Promise<HealthCredentials>;
  observations(credentials: HealthCredentials, range: DayRange, fetcher: typeof fetch): Promise<HealthObservation[]>;
};

const googleSleep = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
const googleVitals = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
const googleHealthUrl = "https://health.googleapis.com/v4/users/me";
const googleOAuthTokenUrl = "https://oauth2.googleapis.com/token";
const withingsBase = "https://wbsapi.withings.net";
const withingsScope = "user.metrics";

export class HealthProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(fetcher: typeof fetch, url: string | URL, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new HealthProviderError(response.status, "Provider request failed.");
  return response.json();
}

async function withingsPost<T>(fetcher: typeof fetch, path: string, params: Record<string, string>, token?: string) {
  const response = await requestJson<{ status: number; body: T }>(fetcher, withingsBase + path, {
    method: "POST",
    body: new URLSearchParams(params),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (response.status !== 0 || !response.body) {
    // Withings reports an expired or invalid token in a successful HTTP response.
    throw new HealthProviderError(response.status === 401 ? 401 : 502, "Withings request failed.");
  }
  return response.body;
}

function credentialsFromToken(result: TokenResponse, accountId: string, previous?: HealthCredentials): HealthCredentials {
  const refreshToken = result.refresh_token ?? previous?.refreshToken;
  const expiresIn = Number(result.expires_in);
  if (!result.access_token || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0 || !accountId) {
    throw new HealthProviderError(502, "Provider did not return a usable account token.");
  }

  return {
    accessToken: result.access_token,
    refreshToken,
    accountId,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: result.scope?.split(/[\s,]+/).filter(Boolean) ?? previous?.scopes ?? [],
    lastSyncedAt: previous?.lastSyncedAt,
  };
}

function authorizeUrl(url: string, options: OAuthOptions, state: string, params: Record<string, string>) {
  const target = new URL(url);
  target.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.callback,
    state,
    ...params,
  }).toString();
  return target;
}

async function googleToken(options: OAuthOptions, params: Record<string, string>) {
  return requestJson<TokenResponse>(fetch, googleOAuthTokenUrl, {
    method: "POST",
    body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }),
  });
}

async function googleData(fetcher: typeof fetch, credentials: HealthCredentials, type: string, filter: string) {
  const api = new URL(`${googleHealthUrl}/dataTypes/${type}/dataPoints:reconcile`);
  api.searchParams.set("filter", filter);
  api.searchParams.set("dataSourceFamily", "users/me/dataSourceFamilies/google-wearables");

  const points: GoogleHealthPoint[] = [];
  const tokens = new Set<string>();
  do {
    const page = await requestJson<{ dataPoints?: GoogleHealthPoint[]; nextPageToken?: string }>(fetcher, api, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    points.push(...(page.dataPoints ?? []));
    if (!page.nextPageToken) return points;
    if (tokens.has(page.nextPageToken) || tokens.size >= 50) break;
    tokens.add(page.nextPageToken);
    api.searchParams.set("pageToken", page.nextPageToken);
  } while (true);
  throw new HealthProviderError(502, "Google Health did not complete pagination.");
}

function dateFilter(field: string, from: string, end: string) {
  return `${field} >= "${from}" AND ${field} < "${end}"`;
}

async function withingsToken(options: OAuthOptions, params: Record<string, string>) {
  return withingsPost<TokenResponse>(fetch, "/v2/oauth2", {
    action: "requesttoken",
    client_id: options.clientId,
    client_secret: options.clientSecret,
    ...params,
  });
}

async function withingsData(fetcher: typeof fetch, credentials: HealthCredentials, range: DayRange) {
  const params = {
    action: "getmeas",
    meastype: "1",
    category: "1",
    // Include adjacent UTC days. The normalized date is filtered in Stockholm time.
    startdate: String(Date.parse(`${shiftHealthDay(range.from, -1)}T00:00:00Z`) / 1000),
    enddate: String(Math.floor(Math.min(Date.now(), Date.parse(`${range.end}T00:00:00Z`)) / 1000)),
  };

  const groups: WithingsMeasureGroup[] = [];
  let offset: number | undefined;
  const offsets = new Set<number>();
  do {
    const page: { measuregrps?: WithingsMeasureGroup[]; more?: number; offset?: number } =
      await withingsPost(fetcher, "/measure", {
        ...params, ...(offset === undefined ? {} : { offset: String(offset) }),
      }, credentials.accessToken);
    groups.push(...(page.measuregrps ?? []));
    if (!page.more) return groups;
    if (page.offset === undefined || offsets.has(page.offset) || offsets.size >= 50) break;
    offsets.add(page.offset);
    offset = page.offset;
  } while (true);
  throw new HealthProviderError(502, "Withings did not complete pagination.");
}

export const healthProviders: Record<HealthProvider, Connector> = {
  "google-health": {
    label: "Google Health / Fitbit",
    env: "GOOGLE_HEALTH",
    authorize: (options, state, verifier) => authorizeUrl("https://accounts.google.com/o/oauth2/v2/auth", options, state, {
      scope: [googleSleep, googleVitals].join(" "),
      access_type: "offline",
      prompt: "consent select_account",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }),
    async exchange(options, code, verifier) {
      const result = await googleToken(options, {
        grant_type: "authorization_code",
        redirect_uri: options.callback,
        code,
        code_verifier: verifier,
      });
      if (!result.access_token) throw new HealthProviderError(502, "Google Health did not return an access token.");
      const identity = await requestJson<{ healthUserId?: string }>(fetch, `${googleHealthUrl}/identity`, {
        headers: { Authorization: `Bearer ${result.access_token}` },
      });
      return credentialsFromToken(result, identity.healthUserId ?? "");
    },
    async refresh(options, previous) {
      const result = await googleToken(options, { grant_type: "refresh_token", refresh_token: previous.refreshToken });
      return credentialsFromToken(result, previous.accountId, previous);
    },
    async observations(credentials, { from, end }, fetcher) {
      const [sleep, rates] = await Promise.all([
        credentials.scopes.includes(googleSleep)
          ? googleData(fetcher, credentials, "sleep", dateFilter("sleep.interval.civil_end_time", shiftHealthDay(from, -1), shiftHealthDay(end, 1)))
          : [],
        credentials.scopes.includes(googleVitals)
          ? googleData(fetcher, credentials, "daily-resting-heart-rate", dateFilter("daily_resting_heart_rate.date", from, end))
          : [],
      ]);
      return googleObservations(sleep, rates);
    },
  },
  withings: {
    label: "Withings",
    env: "WITHINGS",
    authorize: (options, state) => authorizeUrl("https://account.withings.com/oauth2_user/authorize2", options, state, { scope: withingsScope }),
    async exchange(options, code) {
      const result = await withingsToken(options, { grant_type: "authorization_code", redirect_uri: options.callback, code });
      return credentialsFromToken(result, String(result.userid ?? ""));
    },
    async refresh(options, previous) {
      const result = await withingsToken(options, { grant_type: "refresh_token", refresh_token: previous.refreshToken });
      return credentialsFromToken(result, previous.accountId, previous);
    },
    async observations(credentials, range, fetcher) {
      return withingsObservations(await withingsData(fetcher, credentials, range));
    },
  },
};

export function providerName(value: string): HealthProvider | null {
  return Object.hasOwn(healthProviders, value) ? (value as HealthProvider) : null;
}

export function expectedHealthMetrics(provider: HealthProvider, scopes: string[]): Array<HealthObservation["metric"]> {
  if (provider === "withings") return ["body_weight_kg"];
  const metrics: Array<HealthObservation["metric"]> = [];
  if (scopes.includes(googleSleep)) metrics.push("sleep_minutes");
  if (scopes.includes(googleVitals)) metrics.push("resting_heart_rate");
  return metrics;
}

export function providerOptions(provider: HealthProvider): OAuthOptions | null {
  const { env } = healthProviders[provider];
  const clientId = process.env[`${env}_CLIENT_ID`];
  const clientSecret = process.env[`${env}_CLIENT_SECRET`];
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  const callback = new URL(`/api/connections/${provider}/callback`, appUrl);
  if (callback.protocol !== "https:" && !(provider === "google-health" && callback.hostname === "localhost")) return null;
  return { clientId, clientSecret, callback: callback.toString() };
}

export async function providerObservations(
  provider: HealthProvider, credentials: HealthCredentials, range: DayRange, fetcher: typeof fetch = fetch,
) {
  const observations = await healthProviders[provider].observations(credentials, range, fetcher);
  return observations.filter(({ localDay }) => localDay >= range.from && localDay < range.end);
}
