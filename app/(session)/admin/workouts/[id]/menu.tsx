"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/app/ui/icons";
import styles from "./session.module.css";

export type MenuItem =
  | "separator"
  | { label: string; icon?: IconName; onSelect?: () => void; href?: string; danger?: boolean; disabled?: boolean };

/**
 * A small menu on a button. Escape closes it and focus goes back to the button; a tap
 * outside or focus moving on (Tab) closes it too. The arrow keys, Home and End move
 * between items.
 */
export function Menu({ label, items, align = "end", children }: {
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [room, setRoom] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    // The sticky bar at the top of the screen takes the room above; the menu opens on the side
    // with more room and scrolls inside itself when even that side is too short for it.
    const bar = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const below = window.innerHeight - trigger.current.getBoundingClientRect().bottom;
    const above = trigger.current.getBoundingClientRect().top - Math.max(0, bar);
    const height = panel.current.scrollHeight;
    const opensUp = below < height + 12 && above > below;
    setUp(opensUp);
    setRoom(Math.max(96, (opensUp ? above : below) - 12));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setUp(false);
    setRoom(null);
    if (returnFocus) trigger.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close(true);
      return;
    }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const found = [...(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
    if (!found.length) return;
    event.preventDefault();
    const at = found.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Home") found[0].focus();
    else if (event.key === "End") found[found.length - 1].focus();
    else found[(at + (event.key === "ArrowDown" ? 1 : -1) + found.length) % found.length].focus();
  };

  // Focus that moves on to something outside takes the menu with it, so it is never left open behind the reader.
  const onBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !wrap.current?.contains(next)) close(false);
  };

  return (
    <div className={styles.menuWrap} ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        type="button"
        ref={trigger}
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {children ?? <Icon name="more" />}
      </button>
      {open && (
        <div
          id={panelId}
          ref={panel}
          role="menu"
          aria-label={label}
          className={["menu", styles.menuPanel, align === "end" ? styles.menuEnd : styles.menuStart, up ? styles.menuUp : ""].join(" ")}
          style={room === null ? undefined : { maxHeight: room }}
        >
          {items.map((item, index) => {
            if (item === "separator") return <hr key={`s${index}`} />;
            const content = <>{item.icon && <Icon name={item.icon} small />}{item.label}</>;
            const className = item.danger ? "danger" : undefined;
            if (item.href && !item.disabled) {
              return <Link key={item.label} href={item.href} role="menuitem" className={className} onClick={() => close(false)}>{content}</Link>;
            }
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={className}
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
