import { requireOwner } from "@/src/lib/owner";
import { listExercises } from "@/src/lib/workout-store";
import styles from "../../owner.module.css";
import { SheetImport } from "./sheet-import";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import", robots: { index: false, follow: false } };

export default async function Import() {
  await requireOwner();
  const exercises = await listExercises({ includeArchived: true });

  return (
    <>
      <div className="row opener row--stack">
        <div className={styles.full}>
          <h1>Import from a spreadsheet</h1>
          <p className={styles.lede}>
            Copy the rows of your program in Excel or Sheets and paste them here. One exercise per row: name, sets, reps,
            then a load, an RPE or a remark. Workouts side by side and weeks under each other are read as separate templates.
          </p>
        </div>
      </div>
      <SheetImport known={exercises.map(({ name, tracking }) => ({ name, tracking }))} />
    </>
  );
}
