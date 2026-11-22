import assert from "node:assert/strict";
import test from "node:test";

import { googleObservations, healthSyncRange, withingsObservations } from "../src/lib/health-normalize";

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
    group("2026-03-28T05:00:00Z", 84000),
    group("2026-03-28T03:00:00Z", 84420),
    group("2026-03-28T02:59:00Z", 85000),
    group("2026-03-29T02:01:00Z", 84270),
    group("2026-03-29T02:00:00Z", 83900, 1),
    group("2026-03-29T02:00:00Z", 83100, 0, 2),
    group("2026-03-30T10:00:00Z", 83500),
  ]), [
    { externalId: "2026-03-28", metric: "body_weight_kg", localDay: "2026-03-28", observedAt: "2026-03-28T03:00:00.000Z", value: 84.42 },
    { externalId: "2026-03-29", metric: "body_weight_kg", localDay: "2026-03-29", observedAt: "2026-03-29T02:01:00.000Z", value: 84.27 },
  ]);
});

test("force sync refreshes 30 local days even after a provider has synced", () => {
  const now = new Date("2026-03-29T22:30:00Z");
  assert.deepEqual(healthSyncRange(now, true, true), { from: "2026-03-01", end: "2026-03-31" });
  assert.deepEqual(healthSyncRange(now, false, false), { from: "2026-03-01", end: "2026-03-31" });
  assert.deepEqual(healthSyncRange(now, true, false), { from: "2026-03-17", end: "2026-03-31" });
});
