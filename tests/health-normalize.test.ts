import assert from "node:assert/strict";
import test from "node:test";

import { googleObservations, healthSyncRange, shouldAutoSync, withingsObservations } from "../src/lib/health-normalize";

test("pairs the primary sleep with its local wake date and uses the vendor daily heart rate", () => {
  const sleep = [
    { sleep: { interval: { endTime: "2026-03-28T22:30:00Z" }, metadata: { mainSleep: false }, summary: { minutesAsleep: "60" } } },
    { sleep: { interval: { endTime: "2026-03-28T23:30:00Z" }, metadata: { mainSleep: true }, summary: { minutesAsleep: "418", efficiency: 95 } } },
    { sleep: { interval: { endTime: "2026-03-29T22:30:00Z" }, metadata: { mainSleep: true }, summary: { minutesAsleep: "430" } } },
  ];
  assert.deepEqual(googleObservations(sleep, [
    { dailyRestingHeartRate: { date: { year: 2026, month: 3, day: 29 }, beatsPerMinute: "54" } },
    { dailyRestingHeartRate: { date: { year: 2026, month: 2, day: 30 }, beatsPerMinute: "55" } },
  ]), [
    { externalId: "2026-03-29", metric: "sleep_minutes", localDay: "2026-03-29", observedAt: "2026-03-28T23:30:00.000Z", value: 418 },
    { externalId: "2026-03-30", metric: "sleep_minutes", localDay: "2026-03-30", observedAt: "2026-03-29T22:30:00.000Z", value: 430 },
    { externalId: "2026-03-29", metric: "resting_heart_rate", localDay: "2026-03-29", observedAt: null, value: 54 },
  ]);
});

test("selects the earliest attributed Withings morning weigh-in across DST", () => {
  const group = (date: string, value: number, attrib = 0, category = 1) => ({
    date: Date.parse(date) / 1000,
    attrib,
    category,
    measures: [{ type: 1, value, unit: -3 }],
  });
  assert.deepEqual(withingsObservations([
    group("2026-03-28T08:59:59Z", 84000),
    group("2026-03-28T05:00:00Z", 84420),
    group("2026-03-28T04:59:59Z", 85000),
    group("2026-03-29T04:01:00Z", 84270),
    group("2026-03-29T04:00:00Z", 83900, 1),
    group("2026-03-29T04:00:00Z", 83100, 0, 2),
    group("2026-03-30T08:00:00Z", 83500),
  ]), [
    { externalId: "2026-03-28", metric: "body_weight_kg", localDay: "2026-03-28", observedAt: "2026-03-28T05:00:00.000Z", value: 84.42 },
    { externalId: "2026-03-29", metric: "body_weight_kg", localDay: "2026-03-29", observedAt: "2026-03-29T04:01:00.000Z", value: 84.27 },
  ]);
});

test("force sync refreshes 30 local days even after a provider has synced", () => {
  const now = new Date("2026-03-29T22:30:00Z");
  assert.deepEqual(healthSyncRange(now, true, true), { from: "2026-03-01", end: "2026-03-31" });
  assert.deepEqual(healthSyncRange(now, false, false), { from: "2026-03-01", end: "2026-03-31" });
  assert.deepEqual(healthSyncRange(now, true, false), { from: "2026-03-17", end: "2026-03-31" });
});

test("auto-sync refreshes stale providers once per day and stops once today's window is complete", () => {
  // Never synced or synced on an earlier Stockholm day.
  assert.equal(shouldAutoSync({
    provider: "google-health",
    hasTodayData: false,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), true);
  assert.equal(shouldAutoSync({
    provider: "withings",
    lastSyncedAt: "2026-11-22T20:22:18Z",
    hasTodayData: false,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), true);

  // Respects cooldown to avoid hammering upstream APIs.
  assert.equal(shouldAutoSync({
    provider: "google-health",
    lastSyncedAt: "2026-11-23T16:50:00+01:00",
    hasTodayData: false,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), false);

  // Already synced today with today's readings in place: no extra sync.
  assert.equal(shouldAutoSync({
    provider: "google-health",
    lastSyncedAt: "2026-11-23T10:17:00+01:00",
    hasTodayData: true,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), false);
  assert.equal(shouldAutoSync({
    provider: "withings",
    lastSyncedAt: "2026-11-23T08:30:00+01:00",
    hasTodayData: true,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), false);

  // Missing today's readings: Google Health retries after cooldown; Withings only retries if last sync was before 10:15 Stockholm.
  assert.equal(shouldAutoSync({
    provider: "google-health",
    lastSyncedAt: "2026-11-23T10:17:00+01:00",
    hasTodayData: false,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), true);
  assert.equal(shouldAutoSync({
    provider: "withings",
    lastSyncedAt: "2026-11-23T09:50:00+01:00",
    hasTodayData: false,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), true);
  assert.equal(shouldAutoSync({
    provider: "withings",
    lastSyncedAt: "2026-11-23T10:15:00+01:00",
    hasTodayData: false,
    now: new Date("2026-11-23T17:00:00+01:00"),
  }), false);
});
