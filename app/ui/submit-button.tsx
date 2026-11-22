"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A submit button that names what is happening while its form is on the way to the server. */
export function SubmitButton({ children, pending: pendingLabel, className = "btn", ...rest }: {
  children: ReactNode;
  pending?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  "aria-label"?: string;
  formAction?: (form: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} {...rest} disabled={rest.disabled || pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
