export const healthTimeZone = "Europe/Stockholm";
export const withingsMorningStartHour = 6;
export const withingsMorningEndHour = 10;

export type HealthObservation = {
  externalId: string;
  metric: "resting_heart_rate" | "sleep_minutes" | "body_weight_kg";
  localDay: string;
  observedAt: string | null;
  value: number;
};

type CivilDate = { year?: number; month?: number; day?: number };

export type GoogleHealthPoint = {
  sleep?: {
    interval?: { endTime?: string };
    metadata?: { mainSleep?: boolean; manuallyEdited?: boolean };
    summary?: { minutesAsleep?: string };
  };
  dailyRestingHeartRate?: { date?: CivilDate; beatsPerMinute?: string };
};

export type WithingsMeasureGroup = {
  date: number;
  attrib: number;
  category: number;
  measures: Array<{ type: number; value: number; unit: number }>;
};

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: healthTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function localDateAndHour(date: Date) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function healthDay(date: Date) {
  return localDateAndHour(date).day;
}

export function shiftHealthDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function healthSyncRange(now: Date, previouslySynced: boolean, force = false) {
  const today = healthDay(now);
  return {
    from: shiftHealthDay(today, previouslySynced && !force ? -13 : -29),
    end: shiftHealthDay(today, 1),
  };
}

function civilDay(date?: CivilDate) {
  if (!date || !Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) return null;
  const day = [date.year, date.month, date.day].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-");
  const instant = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === day ? day : null;
}

export function googleObservations(sleepPoints: GoogleHealthPoint[], heartRatePoints: GoogleHealthPoint[]) {
  const sleep = new Map<string, HealthObservation>();
  for (const point of sleepPoints) {
    const data = point.sleep;
    if (!data?.metadata?.mainSleep || !data.interval?.endTime) continue;
    const end = new Date(data.interval.endTime);
    const value = Number(data.summary?.minutesAsleep);
    if (!Number.isFinite(end.getTime()) || !Number.isInteger(value) || value <= 0 || value > 1440) continue;
    const localDay = healthDay(end);
    const previous = sleep.get(localDay);
    if (previous && previous.value >= value) continue;
    sleep.set(localDay, { externalId: localDay, metric: "sleep_minutes", localDay, observedAt: end.toISOString(), value });
  }

  const rates = new Map<string, HealthObservation>();
  for (const point of heartRatePoints) {
    const data = point.dailyRestingHeartRate;
    const localDay = civilDay(data?.date);
    const value = Number(data?.beatsPerMinute);
    if (!localDay || !Number.isInteger(value) || value < 1 || value > 300) continue;
    rates.set(localDay, { externalId: localDay, metric: "resting_heart_rate", localDay, observedAt: null, value });
  }

  return [...sleep.values(), ...rates.values()];
}

export function withingsObservations(groups: WithingsMeasureGroup[]) {
  const earliest = new Map<string, HealthObservation>();
  for (const group of groups) {
    // Ignore goals and readings with ambiguous ownership on a shared scale.
    if (group.category !== 1 || (group.attrib !== 0 && group.attrib !== 7)) continue;
    const weight = group.measures?.find((measure) => measure.type === 1);
    if (!weight || !Number.isInteger(weight.unit) || !Number.isInteger(weight.value)) continue;
    const value = weight.value / 10 ** -weight.unit;
    const date = new Date(group.date * 1000);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(value) || value <= 0 || value > 700) continue;
    const { day: localDay, hour } = localDateAndHour(date);
    if (hour < withingsMorningStartHour || hour >= withingsMorningEndHour) continue;
    const observedAt = date.toISOString();
    const previous = earliest.get(localDay);
    if (previous?.observedAt && previous.observedAt <= observedAt) continue;
    earliest.set(localDay, { externalId: localDay, metric: "body_weight_kg", localDay, observedAt, value });
  }
  return [...earliest.values()];
}
