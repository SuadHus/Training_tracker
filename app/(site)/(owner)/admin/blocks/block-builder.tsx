"use client";

import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "@/app/ui/submit-button";
import { createBlockAction } from "@/src/actions/training";
import { addDays, isDay } from "@/src/lib/workout-doc";
import styles from "../../owner.module.css";

const weekdayName = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });

/** The builder: a name, a first day, how many weeks, and which template is trained on which day of the week. */
export function BlockBuilder({ templates, firstDay, mostWeeks }: {
  templates: Array<{ id: string; title: string }>;
  firstDay: string;
  mostWeeks: number;
}) {
  const [start, setStart] = useState(firstDay);
  const from = isDay(start) ? start : firstDay;

  return (
    <form action={createBlockAction} className={`form ${styles.blockForm}`}>
      <div>
        <label className="label" htmlFor="block-title">Name</label>
        <input id="block-title" className="field" name="title" maxLength={120} required autoComplete="off" />
      </div>
      <div className="form-pair">
        <div>
          <label className="label" htmlFor="block-start">First day</label>
          <input id="block-start" className="field" type="date" name="start" value={start} required onChange={(event) => setStart(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="block-weeks">Weeks</label>
          <input id="block-weeks" className="field" type="number" inputMode="numeric" name="weeks" min={1} max={mostWeeks} defaultValue={4} required />
        </div>
        <div>
          <label className="label" htmlFor="block-add">Add each week <span className="hint">kg on every load</span></label>
          <input id="block-add" className="field" inputMode="decimal" name="add_kg" defaultValue="0" autoComplete="off" />
        </div>
      </div>
      <fieldset>
        <legend className="label">The week <span className="hint">which template is trained on which day</span></legend>
        <div className={styles.weekPick}>
          {[0, 1, 2, 3, 4, 5, 6].map((offset) => (
            <div key={offset}>
              <label className="label" htmlFor={`day-${offset}`}>{weekdayName.format(new Date(`${addDays(from, offset)}T00:00:00Z`))}</label>
              <select id={`day-${offset}`} className="select" name={`day_${offset}`} defaultValue="">
                <option value="">Rest</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
              </select>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="form-actions">
        <SubmitButton pending="Building">Build block</SubmitButton>
        <Link className="btn btn--quiet" href="/admin/import?as=block">Paste a block from a spreadsheet</Link>
      </div>
    </form>
  );
}
