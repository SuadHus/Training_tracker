"use client";

import { useEffect, useState } from "react";
import type { Codec } from "./field-input";
import styles from "./session.module.css";

/**
 * One number field in a set row. Typing is held as text so "97." and "97,5" survive;
 * only text that reads as a value is passed on, and text that does not is marked
 * invalid until it is fixed. A value changed from outside replaces the text.
 */
export function MeasureInput<T>({ codec, value, label, placeholder = "", inputMode = "decimal", flagged = false, result = false, className = styles.input, onValue, onEnter }: {
  codec: Codec<T>;
  value: T;
  label: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text";
  flagged?: boolean;
  result?: boolean;
  className?: string;
  onValue: (value: T) => void;
  onEnter?: () => void;
}) {
  const shown = codec.format(value);
  const [text, setText] = useState(shown);
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    const parsed = codec.parse(text);
    if (parsed === "invalid" || codec.format(parsed) !== shown) {
      setText(shown);
      setUnreadable(false);
    }
    // Only an outside change of the value should replace what is typed.
  }, [shown]);

  return (
    <input
      type="text"
      className={className}
      inputMode={inputMode}
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label={label}
      aria-invalid={unreadable || flagged ? true : undefined}
      data-result={result ? "" : undefined}
      value={text}
      placeholder={placeholder}
      onFocus={(event) => {
        const field = event.currentTarget;
        const before = field.value;
        field.select();
        // Some phones drop the selection after the tap; restore it only if nothing was typed yet.
        setTimeout(() => {
          if (field.value === before && document.activeElement === field) field.setSelectionRange(0, before.length);
        }, 0);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = codec.parse(next);
        if (parsed === "invalid") {
          setUnreadable(true);
          return;
        }
        setUnreadable(false);
        onValue(parsed);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onEnter?.();
      }}
    />
  );
}
