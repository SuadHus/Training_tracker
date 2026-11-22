export type FieldKind = "decimal" | "integer" | "text";

export type FieldDefinition = {
  id: string;
  label: string;
  kind: FieldKind;
};

export type CustomValues = Record<string, string | number>;

export class TrainingInputError extends Error {}

export function textInput(form: FormData, name: string, label: string, max: number, required = false) {
  const raw = form.get(name);
  if (raw !== null && typeof raw !== "string") throw new TrainingInputError(`Enter a valid ${label}.`);
  const value = raw?.trim() ?? "";
  if ((required && !value) || value.length > max) {
    throw new TrainingInputError(`Enter ${label} between ${required ? 1 : 0} and ${max} characters.`);
  }
  return value;
}

export function idInput(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw)) {
    throw new TrainingInputError("Select a valid record.");
  }
  return raw;
}

export function parseDate(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(raw)) {
    throw new TrainingInputError("Enter a valid workout date.");
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new TrainingInputError("Enter a valid workout date.");
  }
  return raw;
}

export function trainingDay() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function numberInput(
  form: FormData,
  name: string,
  label: string,
  min: number,
  max: number,
  integer = false,
) {
  const value = textInput(form, name, label, 32);
  if (!value) return null;
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) ||
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new TrainingInputError(`Enter a valid ${label} between ${min} and ${max}.`);
  }
  return parsed;
}

export function parseTypedFields(form: FormData, fields: FieldDefinition[]): CustomValues {
  const values: CustomValues = {};
  for (const field of fields) {
    const key = `custom_${field.id}`;
    if (field.kind === "text") {
      const value = textInput(form, key, field.label, 500);
      if (value) values[field.id] = value;
    } else {
      const value = numberInput(form, key, field.label, -1e9, 1e9, field.kind === "integer");
      if (value !== null) values[field.id] = value;
    }
  }
  return values;
}

export function readActualSet(form: FormData, fields: FieldDefinition[]) {
  const reps = numberInput(form, "reps", "reps", 1, 100000, true);
  const load = numberInput(form, "load_kg", "load", 0, 100000);
  const rpe = numberInput(form, "rpe", "RPE", 1, 10);
  const duration = numberInput(form, "duration_seconds", "duration", 0.01, 86400);
  const distance = numberInput(form, "distance_meters", "distance", 0.01, 1e6);
  const values = parseTypedFields(form, fields);
  if (reps === null && duration === null && distance === null && Object.keys(values).length === 0) {
    throw new TrainingInputError("Record reps, time, distance, or a custom measurement before saving this set.");
  }
  return { reps, load, rpe, duration, distance, values };
}
