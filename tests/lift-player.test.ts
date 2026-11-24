// The player that moves the drawing in the browser, on stubbed globals: whatever it takes while it runs, stop() gives back.
import assert from "node:assert/strict";
import test from "node:test";
import { startPlayer } from "../app/ui/lift-player";
import type { MainLift } from "../src/lib/lift-row";

type Listener = () => void;

/** Stands in for the browser: remembers every listener, observer, timer and frame that is taken and not yet released. */
function stubBrowser(reducedMotion = false) {
  const listeners = new Set<string>();
  const observers = new Set<string>();
  const timers = new Map<number, () => void>();
  const frames = new Map<number, (now: number) => void>();
  let next = 1;
  let resized: Listener | undefined;
  let intersected: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
  const ids = new Map<unknown, number>();
  const idOf = (thing: unknown) => ids.get(thing) ?? (ids.set(thing, ids.size + 1), ids.size);

  const target = (name: string) => ({
    addEventListener: (type: string, listener: unknown) => listeners.add(`${name} ${type} #${idOf(listener)}`),
    removeEventListener: (type: string, listener: unknown) => listeners.delete(`${name} ${type} #${idOf(listener)}`),
  });
  const media = { matches: reducedMotion, ...target("media") };
  const document = { hidden: false, ...target("document") };

  class FakeIntersectionObserver {
    constructor(callback: typeof intersected) { intersected = callback; }
    observe() { observers.add("intersection"); }
    disconnect() { observers.delete("intersection"); }
  }
  class FakeResizeObserver {
    constructor(callback: Listener) { resized = callback; }
    observe() { observers.add("resize"); }
    disconnect() { observers.delete("resize"); }
  }

  const stubs = {
    window: { matchMedia: () => media, setTimeout: (callback: () => void) => { const id = next++; timers.set(id, callback); return id; } },
    document,
    IntersectionObserver: FakeIntersectionObserver,
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: (callback: (now: number) => void) => { const id = next++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  const held: Record<string, PropertyDescriptor | undefined> = {};
  for (const [name, value] of Object.entries(stubs)) {
    held[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return {
    listeners, observers, timers, frames,
    resize: () => resized!(),
    scrollIntoView: () => intersected!([{ isIntersecting: true }]),
    /** Runs the frame that is waiting, as the browser would at this time in milliseconds. */
    frame: (now: number) => { const [id, callback] = [...frames][0]; frames.delete(id); callback(now); },
    restore: () => {
      for (const [name, descriptor] of Object.entries(held)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

const lift: MainLift = { kind: "squat-low", exercise: "Low bar squat", loadKg: 182.5, barKg: 20, reps: 3, rpe: 8.5, day: "Mon 23 Nov" };
const element = { getClientRects: () => [{}], children: [] } as unknown as SVGSVGElement;
const figure = {} as HTMLElement;
const start = (options: { playAtOnce: boolean }) => startPlayer(figure, { wide: element, narrow: element }, lift, { ...options, onReadout: () => {} });

test("while it plays the player holds listeners, observers, a timer and a frame, and stop() releases every one", () => {
  const browser = stubBrowser();
  try {
    const { stop } = start({ playAtOnce: true });
    browser.resize();
    browser.frame(1000);
    browser.frame(1016);
    assert.equal(browser.listeners.size, 2, "the tab's visibility and the reader's motion setting");
    assert.deepEqual([...browser.observers].sort(), ["intersection", "resize"]);
    assert.equal(browser.timers.size, 1, "the size check after a resize");
    assert.equal(browser.frames.size, 1, "the next frame of the set that is playing");

    stop();
    assert.deepEqual([browser.listeners.size, browser.observers.size, browser.timers.size, browser.frames.size], [0, 0, 0, 0]);
  } finally {
    browser.restore();
  }
});

test("a set that waits for its figure to come into view holds no frame, and starts when it does", () => {
  const browser = stubBrowser();
  try {
    const { stop } = start({ playAtOnce: false });
    assert.equal(browser.frames.size, 0);
    browser.scrollIntoView();
    assert.equal(browser.frames.size, 1, "it plays once on screen");
    stop();
    assert.deepEqual([browser.listeners.size, browser.observers.size, browser.timers.size, browser.frames.size], [0, 0, 0, 0]);
  } finally {
    browser.restore();
  }
});

test("with reduced motion nothing plays by itself, and stop() still releases what was taken", () => {
  const browser = stubBrowser(true);
  try {
    const { stop } = start({ playAtOnce: true });
    browser.scrollIntoView();
    assert.equal(browser.frames.size, 0);
    stop();
    assert.deepEqual([browser.listeners.size, browser.observers.size, browser.timers.size, browser.frames.size], [0, 0, 0, 0]);
  } finally {
    browser.restore();
  }
});
