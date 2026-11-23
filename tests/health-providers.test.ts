import assert from "node:assert/strict";
import test from "node:test";

import { expectedHealthMetrics, healthProviders, providerObservations } from "../src/lib/health-providers";

test("fetches all reconcile pages for the granted Google scope", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const continued = url.searchParams.has("pageToken");
    return Response.json({
      dataPoints: [{
        sleep: {
          interval: { endTime: continued ? "2026-11-21T06:00:00Z" : "2026-11-20T06:00:00Z" },
          metadata: { mainSleep: true },
          summary: { minutesAsleep: "423" },
        },
      }],
      ...(continued ? {} : { nextPageToken: "next" }),
    });
  };
  const observations = await providerObservations("google-health", {
    accessToken: "test",
    refreshToken: "test",
    accountId: "test",
    expiresAt: 0,
    scopes: ["https://www.googleapis.com/auth/googlehealth.sleep.readonly"],
  }, { from: "2026-11-20", end: "2026-11-22" }, fetcher);
  assert.deepEqual(observations.map((observation) => observation.localDay), ["2026-11-20", "2026-11-21"]);
  assert.deepEqual(requests.map((request) => request.pathname), [
    "/v4/users/me/dataTypes/sleep/dataPoints:reconcile", "/v4/users/me/dataTypes/sleep/dataPoints:reconcile",
  ]);
  assert.equal(requests[1]?.searchParams.get("pageToken"), "next");
  assert.equal(requests[0]?.searchParams.get("dataSourceFamily"), "users/me/dataSourceFamilies/google-wearables");
});

test("Withings requests only weight and follows its numeric offset", async () => {
  const offsets: Array<string | null> = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://wbsapi.withings.net/measure");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("meastype"), "1");
    assert.equal(body.get("category"), "1");
    offsets.push(body.get("offset"));
    return Response.json({ status: 0, body: { measuregrps: [{
      date: Date.parse(offsets.length === 1 ? "2026-11-20T08:00:00Z" : "2026-11-20T05:00:00Z") / 1000,
      attrib: 0, category: 1,
      measures: [{ type: 1, value: offsets.length === 1 ? 85100 : 84600, unit: -3 }],
    }], more: offsets.length === 1 ? 1 : 0, offset: 42 } });
  };
  const observations = await providerObservations("withings", {
    accessToken: "test", refreshToken: "test", accountId: "test", expiresAt: 0, scopes: ["user.metrics"],
  }, { from: "2026-11-20", end: "2026-11-22" }, fetcher);
  assert.deepEqual(offsets, [null, "42"]);
  assert.equal(observations[0]?.value, 84.6);
});

test("uses distinct OAuth permissions and signed state", () => {
  const options = { clientId: "test", clientSecret: "test", callback: "https://training.example/callback" };
  const google = healthProviders["google-health"].authorize(options, "state", "verifier");
  const withings = healthProviders.withings.authorize(options, "state", "verifier");
  assert.equal(google.searchParams.get("code_challenge_method"), "S256");
  assert.equal(google.searchParams.get("access_type"), "offline");
  assert.equal(withings.searchParams.get("scope"), "user.metrics");
  assert.equal(withings.searchParams.get("state"), "state");
});

test("derives expected daily metrics from provider and granted scopes", () => {
  assert.deepEqual(expectedHealthMetrics("withings", ["user.metrics"]), ["body_weight_kg"]);
  assert.deepEqual(expectedHealthMetrics("google-health", [
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  ]), ["sleep_minutes"]);
  assert.deepEqual(expectedHealthMetrics("google-health", [
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  ]), ["sleep_minutes", "resting_heart_rate"]);
});
