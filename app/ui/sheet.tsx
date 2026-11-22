"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

/**
 * A modal sheet on the native dialog element: from the bottom on a phone,
 * centred on a desk. Escape and a tap outside close it; focus returns to
 * whatever opened it.
 */
export function Sheet({ open, title, onClose, children, footer }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      {open && <>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </>}
    </dialog>
  );
}
