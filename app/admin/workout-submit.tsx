"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function WorkoutSubmit({ children, className, label, disabled, pendingLabel = "Saving…" }: {
  children: ReactNode;
  className?: string;
  label?: string;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} aria-label={label} disabled={disabled || pending}>
    {pending && !label ? pendingLabel : children}
  </button>;
}
