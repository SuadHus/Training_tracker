import type { StageSize } from "@/src/lib/lift-camera";
import { drawLift, makeMemo } from "@/src/lib/lift-draw";
import { makeLiftSet } from "@/src/lib/lift-motion";
import { stageFor } from "@/src/lib/lift-plan";
import { counterOf, drawnReps, platesOf, type Counter, type MainLift } from "@/src/lib/lift-row";
import { buttonWord, initialTransport, isMoving, shouldAutoStart, transport, type Transport, type TransportEvent } from "@/src/lib/lift-transport";
import { SvgDrawing } from "./lift-svg";

/** What a reader can read of the set while it plays: the rep counter and the word on the button. Changes a few times a second at most. */
export type Readout = { counter: Counter; word: string };

export type Player = {
  /** What the button does: pause a set that wants to play, play (or replay) one that does not. */
  toggle(): void;
  /** Back to the still, and playing from the start unless the reader asked for reduced motion. */
  replay(): void;
};

/**
 * Drives the drawing React wrote for one lift. The set plays once when its figure scrolls into view and rests on its most telling still;
 * it stops while the figure is off screen or the tab is hidden, and reduced motion keeps it still until Play is pressed. Returns what to
 * call to stop: every observer, listener, timer and frame is released then.
 */
export function startPlayer(
  figure: HTMLElement,
  svgs: Record<StageSize, SVGSVGElement>,
  lift: MainLift,
  options: { playAtOnce: boolean; onReadout: (readout: Readout) => void },
): { player: Player; stop: () => void } {
  const set = makeLiftSet(lift.kind, { reps: drawnReps(lift) });
  const plates = platesOf(lift);
  const memo = makeMemo();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const frameOf = (size: StageSize, t: number) => drawLift({ pose: set.pose(t), scene: set.scene, plates, stage: stageFor(lift.kind, size), memo });

  const drawings = new Map<StageSize, SvgDrawing>();
  for (const size of ["wide", "narrow"] as const) {
    const drawing = SvgDrawing.adopt(svgs[size], frameOf(size, set.heroTime));
    if (drawing) drawings.set(size, drawing);
  }

  let state: Transport = transport({ ...initialTransport, tabHidden: document.hidden }, { type: "show", duration: set.duration, hero: set.heroTime });
  let frame = 0, lastNow = 0, sizeTimer = 0;
  let told = "";

  // The stylesheet decides which size shows (a container query on the figure); the page only asks which one it did.
  const sizeNow = (): StageSize => (svgs.wide.getClientRects().length > 0 ? "wide" : "narrow");

  function render(): void {
    const shown = sizeNow();
    drawings.get(shown)?.update(frameOf(shown, state.t));
    const counter = counterOf(set.reps, set.repAt(state.t), set.phase(state.t), state.ended);
    const word = buttonWord(state);
    const key = `${counter.shown}/${counter.done}/${counter.phase}/${word}`;
    if (key !== told) {
      told = key;
      options.onReadout({ counter, word });
    }
  }

  function sync(): void {
    if (isMoving(state)) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastNow = 0;
    }
  }

  function tick(now: number): void {
    frame = 0;
    const dt = lastNow ? (now - lastNow) / 1000 : 0;
    lastNow = now;
    state = transport(state, { type: "tick", dt });
    render();
    sync();
  }

  /** Feeds an event to the clock, then draws and starts or stops the frame loop. */
  function dispatch(event: TransportEvent): void {
    state = transport(state, event);
    render();
    sync();
  }

  const player: Player = {
    toggle: () => dispatch({ type: state.playing ? "pause" : "play" }),
    replay: () => {
      dispatch({ type: "show", duration: set.duration, hero: set.heroTime });
      if (!reduce.matches) dispatch({ type: "play" });
    },
  };

  // ---------------------------------------------------------------- listeners, all removed by stop()
  const cleanups: Array<() => void> = [];
  const on = (target: EventTarget, type: string, listener: () => void) => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  on(document, "visibilitychange", () => dispatch({ type: "tabHidden", value: document.hidden }));
  on(reduce, "change", () => { if (reduce.matches && state.playing) dispatch({ type: "pause" }); });

  const watcher = new IntersectionObserver((entries) => {
    dispatch({ type: "visible", value: entries[entries.length - 1].isIntersecting });
    if (shouldAutoStart(state, reduce.matches)) dispatch({ type: "play" });
  }, { threshold: 0.35 });
  watcher.observe(figure);
  cleanups.push(() => watcher.disconnect());

  let size = sizeNow();
  const resizer = new ResizeObserver(() => {
    clearTimeout(sizeTimer);
    sizeTimer = window.setTimeout(() => { if (sizeNow() !== size) { size = sizeNow(); render(); } }, 0);
  });
  resizer.observe(figure);
  cleanups.push(() => resizer.disconnect(), () => clearTimeout(sizeTimer));

  render();
  if (options.playAtOnce && !reduce.matches) dispatch({ type: "play" });

  return {
    player,
    stop: () => {
      cleanups.forEach((cleanup) => cleanup());
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
