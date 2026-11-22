import { requireOwner } from "@/src/lib/owner";
import { exerciseLibrary, listFields } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";
import { ExerciseLibrary } from "./exercise-library";
import { FieldList } from "./field-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exercises", robots: { index: false, follow: false } };

export default async function Exercises() {
  await requireOwner();
  const [exercises, fields] = await Promise.all([exerciseLibrary(), listFields()]);

  return (
    <>
      <div className="row opener row--stack">
        <div className={styles.full}>
          <h1>Exercises</h1>
          <p className={styles.lede}>Every exercise you can put in a workout, with how often you have done it and the best set so far.</p>
        </div>
      </div>
      <div className="row row--flush">
        <div className={styles.full}><ExerciseLibrary exercises={exercises} /></div>
      </div>
      <div className="row row--section row--stack">
        <h2 className="row-margin">Extra set fields</h2>
        <FieldList fields={fields} exercises={exercises.filter(({ archived }) => !archived).map(({ id, name }) => ({ id, name }))} />
      </div>
    </>
  );
}
