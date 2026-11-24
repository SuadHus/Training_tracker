"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { edgeSpeed, landingIndex, makeRoom, numbersAfter, sameList, type Box } from "@/src/lib/block-drag";
import styles from "./session.module.css";

export const gripId = (blockId: string) => `grip-${blockId}`;
/** The sentence every handle is described by: how to move a block without a pointer. */
export const gripHintId = "grip-hint";

/** A finger that moves less than this has tapped the handle, not picked the block up. */
const PICK_UP_DISTANCE = 4;
const SETTLE_MS = 160;

type Carry = {
  handle: HTMLElement;
  pointerId: number;
  items: HTMLElement[];
  boxes: Box[];
  from: number;
  to: number;
  /** Pointer height in page coordinates where it went down, and now. */
  startY: number;
  clientY: number;
  /** The carried block's offset: it follows the pointer but stays inside the list. */
  offset: number;
  lifted: boolean;
  frame: number;
  stop: () => void;
};

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Carrying an exercise to another place with the grip in its header. Pointer Events with
 * capture, so a finger, a pen and a mouse all do it; the handle alone has `touch-action: none`,
 * so the page scrolls under a finger everywhere else. While a block is carried it follows the
 * pointer and the others move aside by a transform; nothing is laid out again until the drop,
 * which calls `move` once, and only if the place changed. Escape or a cancelled pointer puts
 * everything back, and so does the list changing under the carry (a remote edit removed the handle
 * or added or took away a block): the places measured at pick-up would no longer be the page's.
 * The arrow keys on the handle move the block one place, and Enter says how.
 */
export function useBlockDrag(
  list: RefObject<HTMLOListElement | null>,
  move: (blockId: string, to: number) => void,
  explain: (blockId: string) => void,
) {
  const carry = useRef<Carry | null>(null);
  const moveRef = useRef(move);
  const explainRef = useRef(explain);
  useEffect(() => {
    moveRef.current = move;
    explainRef.current = explain;
  }, [move, explain]);

  // A page that goes away mid-carry takes the listeners with it.
  useEffect(() => () => carry.current?.stop(), []);

  const start = useCallback((blockId: string, event: PointerEvent<HTMLElement>) => {
    const handle = event.currentTarget;
    const found = list.current;
    const mine = handle.closest("li");
    if (carry.current || event.button !== 0 || !found || !mine) return;
    const ol: HTMLOListElement = found;
    const item: HTMLElement = mine;
    const items = Array.from(ol.children) as HTMLElement[];
    const from = items.indexOf(item);
    if (from === -1) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    // While carrying, each block shows the number it will have once dropped. An attribute the stylesheet draws, so the
    // text React owns is never touched.
    const numbers = items.map((one) => one.querySelector<HTMLElement>(`.${styles.exNo}`));
    const width = ol.clientWidth;
    const boxes = items.map((one) => {
      const rect = one.getBoundingClientRect();
      return { top: rect.top + window.scrollY, height: rect.height };
    });
    const state: Carry = {
      handle, pointerId: event.pointerId, items, boxes, from, to: from,
      startY: event.clientY + window.scrollY, clientY: event.clientY, offset: 0, lifted: false, frame: 0, stop: () => {},
    };
    carry.current = state;

    // The list the boxes were measured from, still standing?
    const stale = () => !handle.isConnected || !sameList(items, ol.children);
    const renumber = (to: number) => {
      const next = numbersAfter(items.length, from, to);
      numbers.forEach((number, at) => number?.setAttribute("data-carry", String(next[at])));
    };
    const follow = () => {
      if (stale()) return finish(false);
      const y = state.clientY + window.scrollY;
      const delta = y - state.startY;
      if (!state.lifted) {
        if (Math.abs(delta) < PICK_UP_DISTANCE) return;
        state.lifted = true;
        ol.dataset.carrying = "";
        item.classList.add(styles.carried);
      }
      const first = boxes[0].top;
      const last = boxes[boxes.length - 1].top + boxes[boxes.length - 1].height;
      const own = boxes[from];
      state.offset = Math.min(Math.max(delta, first - own.top), last - own.top - own.height);
      item.style.transform = `translateY(${state.offset}px)`;
      const to = landingIndex(boxes, from, y);
      if (to === state.to) return;
      state.to = to;
      renumber(to);
      const room = makeRoom(boxes, from, to);
      items.forEach((one, at) => {
        if (at !== from) one.style.transform = room[at] ? `translateY(${room[at]}px)` : "";
      });
    };

    const onMove = (moved: globalThis.PointerEvent) => {
      if (moved.pointerId !== state.pointerId) return;
      state.clientY = moved.clientY;
      follow();
    };
    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId === state.pointerId) finish(true);
    };
    const onCancel = (cancelled: globalThis.PointerEvent) => {
      if (cancelled.pointerId === state.pointerId) finish(false);
    };
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      finish(false);
    };
    const onAway = () => finish(false);
    // Mobile browsers resize the window as the toolbar slides in and out: only a change of width moves the blocks.
    const onResize = () => {
      if (ol.clientWidth !== width) finish(false);
    };
    // A handle that is removed mid-carry gets no pointerup; the browser says the capture was lost, at the document.
    const onLost = (lost: globalThis.PointerEvent) => {
      if (lost.pointerId === state.pointerId) finish(false);
    };

    // The page scrolls by itself while the pointer is held near the top or bottom edge. The boxes were
    // measured in page coordinates, so the scroll alone moves the pointer over them.
    const scrolling = () => {
      if (state.lifted) {
        const bar = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
        const speed = edgeSpeed(state.clientY, Math.max(0, bar), window.innerHeight);
        if (speed) window.scrollBy(0, speed);
      }
      state.frame = requestAnimationFrame(scrolling);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("lostpointercapture", onLost);
    window.addEventListener("blur", onAway);
    state.frame = requestAnimationFrame(scrolling);

    state.stop = () => {
      cancelAnimationFrame(state.frame);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("lostpointercapture", onLost);
      window.removeEventListener("blur", onAway);
      if (handle.hasPointerCapture(state.pointerId)) handle.releasePointerCapture(state.pointerId);
      state.stop = () => {};
      if (carry.current === state) carry.current = null;
    };

    function finish(drop: boolean) {
      state.stop();
      if (!state.lifted) return;
      // A list that changed under the carry puts everything back instead of moving by an index of the old one.
      const standing = !stale();
      for (const number of numbers) number?.removeAttribute("data-carry");
      // Where every block is drawn now, so the ones that land elsewhere can ease there from it.
      const before = new Map(items.map((one) => [one, one.getBoundingClientRect().top]));
      const refocus = document.activeElement === handle;
      delete ol.dataset.carrying;
      for (const one of items) one.style.transform = "";
      if (!standing) {
        delete ol.dataset.carrying;
        for (const one of items) one.style.transform = "";
        item.classList.remove(styles.carried);
        return;
      }
      if (drop && state.to !== from) flushSync(() => moveRef.current(blockId, state.to));
      if (refocus) document.getElementById(gripId(blockId))?.focus({ preventScroll: true });

      if (calm()) {
        item.classList.remove(styles.carried);
        return;
      }
      for (const one of Array.from(ol.children) as HTMLElement[]) {
        const shift = (before.get(one) ?? 0) - one.getBoundingClientRect().top;
        if (Math.abs(shift) < 0.5) continue;
        one.style.transition = "none";
        one.style.transform = `translateY(${shift}px)`;
      }
      void ol.offsetHeight;
      const settle = Array.from(ol.children) as HTMLElement[];
      for (const one of settle) {
        if (!one.style.transform) continue;
        one.style.transition = `transform ${SETTLE_MS}ms ease-out`;
        one.style.transform = "";
      }
      setTimeout(() => {
        for (const one of settle) one.style.transition = "";
        item.classList.remove(styles.carried);
      }, SETTLE_MS + 40);
    }
  }, [list]);

  const press = useCallback((blockId: string, at: number, count: number, event: KeyboardEvent<HTMLElement>) => {
    if (carry.current) return;
    // A button that does nothing on Enter or Space would be a puzzle to hear: say what the handle is for.
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      explainRef.current(blockId);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const to = Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), count - 1);
    flushSync(() => moveRef.current(blockId, to));
    // The list was reordered under the focus; put it back on the handle and keep the block in sight.
    const handle = document.getElementById(gripId(blockId));
    handle?.focus({ preventScroll: true });
    handle?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, []);

  return { start, press };
}
