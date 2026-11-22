import { randomUUID } from "node:crypto";
import { startWorkoutAction } from "@/src/actions/training";
import { SubmitButton } from "@/app/ui/submit-button";

/** One tap from a template to a session for today. The id makes a double submit create one session. */
export function StartTemplate({ templateId, label = "Start" }: { templateId: string; label?: string }) {
  return (
    <form action={startWorkoutAction}>
      <input type="hidden" name="id" value={randomUUID()} />
      <input type="hidden" name="kind" value="planned" />
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="when" value="today" />
      <SubmitButton pending="Starting">{label}</SubmitButton>
    </form>
  );
}

export function exerciseNames(names: string[], total: number): string {
  if (names.length === 0) return "No exercises yet";
  return total > names.length ? `${names.join(", ")}, and ${total - names.length} more` : names.join(", ");
}
