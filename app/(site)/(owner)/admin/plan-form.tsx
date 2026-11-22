"use client";

import { useState } from "react";
import { dayLabel } from "@/src/lib/day-format";
import { SubmitButton } from "@/app/ui/submit-button";
import { startWorkoutAction } from "@/src/actions/training";
import styles from "../owner.module.css";

export function PlanForm({ id, templates, defaultDay }: {
  id: string;
  templates: { id: string; title: string }[];
  defaultDay: string;
}) {
  const [template, setTemplate] = useState("");
  const [day, setDay] = useState(defaultDay);

  return (
    <form action={startWorkoutAction} className={styles.plan} aria-labelledby="plan-heading">
      <h3 id="plan-heading" className={styles.planHeading}>Plan a session</h3>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value="planned" />
      <input type="hidden" name="when" value="day" />
      <div>
        <label className="label" htmlFor="plan-template">Template</label>
        <select id="plan-template" className="select" name="template_id" value={template} onChange={(event) => setTemplate(event.target.value)}>
          <option value="">Blank session</option>
          {templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="plan-name">Name{template && <span className="hint"> (optional)</span>}</label>
        <input id="plan-name" className="field" name="title" maxLength={120} required={!template} autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="plan-day">Date</label>
        <input id="plan-day" className="field" type="date" name="day" value={day} onChange={(event) => setDay(event.target.value)} required aria-describedby="plan-day-echo" />
        <p id="plan-day-echo" className={styles.dateEcho}>{/^\d{4}-\d{2}-\d{2}$/.test(day) ? dayLabel(day) : "Pick a date"}</p>
      </div>
      <div>
        <SubmitButton pending="Planning">Plan session</SubmitButton>
      </div>
    </form>
  );
}
