"use client";

import { useState } from "react";
import { createWorkout } from "./actions";
import { WorkoutSubmit } from "./workout-submit";
import styles from "./admin.module.css";

type TemplateOption = { id: string; title: string; set_count: number };

export function WorkoutPlanner({ today, templates, submissionId }: { today: string; templates: TemplateOption[]; submissionId: string }) {
  const [date, setDate] = useState(today);
  const [templateId, setTemplateId] = useState("");
  const selected = templates.find((template) => template.id === templateId);

  return (
    <form action={createWorkout} className={styles.form}>
      <input type="hidden" name="status" value="planned" />
      <input type="hidden" name="submission_id" value={submissionId} />
      {templates.length > 0 && <label>Start from
        <select name="template_id" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          <option value="">Blank workout</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
        </select>
      </label>}
      <label>Workout name {selected && <span className={styles.optional}>Optional</span>}
        <input name="title" maxLength={120} required={!selected} placeholder={selected?.title ?? "e.g. Lower body A"} />
      </label>
      <label>Workout date
        <input name="local_day" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </label>
      {selected && <p className={styles.formHint}>{selected.set_count} target {selected.set_count === 1 ? "set" : "sets"} will be copied.</p>}
      <div className={styles.actions}><WorkoutSubmit pendingLabel="Opening…">{date === today ? "Start workout" : "Create workout"}</WorkoutSubmit></div>
    </form>
  );
}
