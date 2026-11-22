import { addDays } from "@/src/lib/workout-doc";

const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** Seven columns for one week. A trained day carries its date in a solid square; today is underlined. */
export function WeekStrip({ start, trained, today }: { start: string; trained: ReadonlySet<string>; today?: string }) {
  return (
    <ol className="strip" aria-label="Days trained this week">
      {weekdays.map((weekday, index) => {
        const day = addDays(start, index);
        const done = trained.has(day);
        return (
          <li key={day} className="strip-day" data-trained={done || undefined} data-today={day === today || undefined}>
            <span aria-hidden="true">{weekday}</span>
            <span className="strip-mark num">
              <span className="sr">{names[index]} </span>{Number(day.slice(8))}
              <span className="sr">{done ? ", trained" : ", no session"}{day === today ? ", today" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The same week as seven small squares, for lists of many weeks. */
export function WeekDots({ start, trained }: { start: string; trained: ReadonlySet<string> }) {
  const days = weekdays.map((_, index) => addDays(start, index));
  const label = days.flatMap((day, index) => (trained.has(day) ? [names[index]] : [])).join(", ");
  return (
    <span className="dots" role="img" aria-label={label ? `Trained ${label}` : "No sessions"}>
      {days.map((day) => <i key={day} className="dot" data-trained={trained.has(day) || undefined} />)}
    </span>
  );
}

export function WeekDotsHead() {
  return <span className="dots-head" aria-hidden="true">{weekdays.map((weekday, index) => <span key={index}>{weekday[0]}</span>)}</span>;
}
