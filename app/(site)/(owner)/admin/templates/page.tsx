import { randomUUID } from "node:crypto";
import Link from "next/link";
import { startWorkoutAction } from "@/src/actions/training";
import { SubmitButton } from "@/app/ui/submit-button";
import { requireOwner } from "@/src/lib/owner";
import { deskData } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";
import { exerciseNames, StartTemplate } from "../../start-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Templates", robots: { index: false, follow: false } };

export default async function Templates({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error } = await searchParams;
  const { templates } = await deskData();

  return (
    <>
      <div className="row opener row--stack">
        <div className={styles.full}>
          <h1>Templates</h1>
          <p className={styles.lede}>A template is a workout you repeat. Start one from the desk and it becomes today&rsquo;s session, with its exercises and target sets filled in.</p>
        </div>
      </div>

      {error && <div className="row row--flush row--stack"><div /><p className="notice notice--alert" role="alert">{error}</p></div>}

      {templates.length > 0 ? templates.map((template) => (
        <div className="row row--stack" key={template.id}>
          <div className="row-margin">{template.timesUsed ? `Used ${template.timesUsed} ${template.timesUsed === 1 ? "time" : "times"}` : "New"}</div>
          <div className={`${styles.item} ${styles.itemWrap} ${styles.itemPlain}`}>
            <div className={styles.main}>
              <span className={styles.title}><Link href={`/admin/workouts/${template.id}`}>{template.title}</Link></span>
              <span className={styles.names}>{exerciseNames(template.exercises, template.exerciseCount)}</span>
              <span className={`${styles.names} light`}>{template.setCount} {template.setCount === 1 ? "set" : "sets"}</span>
            </div>
            <div className={styles.actions}>
              <StartTemplate templateId={template.id} />
              <Link className="btn btn--quiet" href={`/admin/workouts/${template.id}`}>Edit<span className="sr"> {template.title}</span></Link>
            </div>
          </div>
        </div>
      )) : (
        <div className="row row--stack">
          <div className="row-margin" />
          <p className="empty-line">A template is a list of exercises with target sets. Create one, add exercises, then start it from the desk.</p>
        </div>
      )}

      <div className="row row--section row--stack">
        <h2 className="row-margin">New template</h2>
        <form action={startWorkoutAction} className="form">
          <input type="hidden" name="id" value={randomUUID()} />
          <input type="hidden" name="kind" value="template" />
          <div>
            <label className="label" htmlFor="template-name">Name</label>
            <input id="template-name" className="field" name="title" maxLength={120} required autoComplete="off" />
          </div>
          <div className="form-actions"><SubmitButton pending="Creating">Create template</SubmitButton></div>
        </form>
      </div>
    </>
  );
}
