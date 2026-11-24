"use client";

import { memo, useEffect, useRef, useState, type RefObject } from "react";
import type { StageSize } from "@/src/lib/lift-camera";
import { drawLift } from "@/src/lib/lift-draw";
import { makeLiftSet } from "@/src/lib/lift-motion";
import { stageFor } from "@/src/lib/lift-plan";
import { altText, counterOf, countedPlates, drawnReps, LONG_STACK, platesOf, shortName, squareClasses, type MainLift } from "@/src/lib/lift-row";
import { buttonWord, initialTransport } from "@/src/lib/lift-transport";
import { formatNumber, STANDARD_BAR_KG } from "@/src/lib/workout-doc";
import { perSide } from "./bar-load";
import { startPlayer, type Player, type Readout } from "./lift-player";
import { Notation } from "./notation";

// The week's main lifts, drawn as a lifter who lifts the real load for the real reps. React writes the first frame, so the page has its
// real size and a picture before any script runs; after hydration an effect hands the drawing to `startPlayer`, which moves the shapes
// that are already there. React state changes only when something a reader can read changes, never once per frame.

/** The picture before anything has played: the set at its most telling still. */
function restingReadout(lift: MainLift): Readout {
  const set = makeLiftSet(lift.kind, { reps: drawnReps(lift) });
  return { counter: counterOf(set.reps, set.repAt(set.heroTime), set.phase(set.heroTime), false), word: buttonWord(initialTransport) };
}

/** What the drawing depends on: when any of it changes the drawing is a new one, and so is the player that moves it. */
const drawingKey = (lift: MainLift) => `${lift.kind}|${lift.exercise}|${lift.loadKg}|${lift.barKg}|${lift.reps}`;

type DrawingProps = { lift: MainLift; size: StageSize; svgRef: RefObject<SVGSVGElement | null> };

/**
 * One size of the drawing, as the first frame. It is memoised on the lift (its fields, not the object the server happened to hand over)
 * and the size, and the stage gives it a key made of them: it renders once, and is never rendered again over the shapes the player moves.
 */
const Drawing = memo(function Drawing({ lift, size, svgRef }: DrawingProps) {
  const set = makeLiftSet(lift.kind, { reps: drawnReps(lift) });
  const plates = platesOf(lift);
  const drawing = drawLift({ pose: set.pose(set.heroTime), scene: set.scene, plates, stage: stageFor(lift.kind, size) });
  // The last digit of a trigonometric function can differ between Node and a browser engine: the player adopts these shapes by id and
  // never compares their attributes with the server's, so a difference is not a mismatch.
  return (
    <svg ref={svgRef} className={`lf lf-${size}`} viewBox={drawing.viewBox} role="img" focusable="false" aria-label={altText(lift, plates, set.reps)}>
      {drawing.prims.map((prim) => (prim.el === "text"
        ? <text key={prim.id} data-k={prim.id} className={prim.cls} {...prim.attrs} suppressHydrationWarning>{prim.text}</text>
        : <path key={prim.id} data-k={prim.id} className={prim.cls} {...prim.attrs} suppressHydrationWarning />))}
    </svg>
  );
}, (before, after) => before.size === after.size && drawingKey(before.lift) === drawingKey(after.lift));

const sameReadout = (a: Readout, b: Readout) =>
  a.word === b.word && a.counter.shown === b.counter.shown && a.counter.done === b.counter.done && a.counter.phase === b.counter.phase;

/** The lifts of the week, heaviest first, one drawn at a time: tabs to choose, the caption, the lifter, a button and the rep counter. */
export function LiftStage({ lifts }: { lifts: MainLift[] }) {
  const [kind, setKind] = useState(lifts[0].kind);
  const lift = lifts.find((candidate) => candidate.kind === kind) ?? lifts[0];
  const [readout, setReadout] = useState(() => restingReadout(lift));
  const figure = useRef<HTMLDivElement>(null);
  const wide = useRef<SVGSVGElement>(null);
  const narrow = useRef<SVGSVGElement>(null);
  const player = useRef<Player | null>(null);
  // A lift the reader chose plays at once; the one the page opens on waits until it scrolls into view.
  const chosen = useRef(false);

  const { exercise, loadKg, barKg, reps, rpe, day } = lift;
  const identity = drawingKey(lift);
  useEffect(() => {
    if (!figure.current || !wide.current || !narrow.current) return;
    const playing = startPlayer(figure.current, { wide: wide.current, narrow: narrow.current }, lift, {
      playAtOnce: chosen.current,
      onReadout: (next) => setReadout((held) => (sameReadout(held, next) ? held : next)),
    });
    chosen.current = false;
    player.current = playing.player;
    return () => {
      player.current = null;
      playing.stop();
    };
    // The player needs only what the drawing depends on; the RPE and the day are words of the caption.
  }, [identity]);

  const choose = (next: MainLift) => {
    if (next.kind === kind) {
      player.current?.replay();
      return;
    }
    chosen.current = true;
    setKind(next.kind);
    setReadout(restingReadout(next));
  };

  const plates = platesOf(lift);
  const line = plates.length > LONG_STACK ? countedPlates(plates) : perSide(loadKg, barKg);

  return (
    <div className="lift">
      {lifts.length > 1 && (
        <ul className="lift-tabs" aria-label="Main lifts this week">
          {lifts.map((option) => (
            <li key={option.kind}>
              <button type="button" aria-pressed={option.kind === lift.kind} aria-label={option.exercise} onClick={() => choose(option)}>
                <span className="lift-tab-full" aria-hidden="true">{option.exercise}</span>
                <span className="lift-tab-short" aria-hidden="true">{shortName(option.kind)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="lift-caption">
        <span className="soft">{exercise}</span>{" "}
        <Notation measures={{ reps, load: loadKg, rpe, duration: null, distance: null }} />, {day}
        <br />
        <span className="soft">per side</span> <b>{line}</b>
        {barKg !== STANDARD_BAR_KG && <> <span className="soft">on a {formatNumber(barKg)} kg bar</span></>}
      </p>
      <div className="lift-figure" ref={figure}>
        <Drawing key={`${identity}|wide`} lift={lift} size="wide" svgRef={wide} />
        <Drawing key={`${identity}|narrow`} lift={lift} size="narrow" svgRef={narrow} />
      </div>
      <div className="lift-foot">
        <button type="button" className="btn btn--plain lift-play" onClick={() => player.current?.toggle()}>{readout.word}</button>
        <p className="lift-count" aria-hidden="true">
          <span className="lift-rep">Rep <b>{readout.counter.shown}</b> of {readout.counter.total}</span>
          <span className="light lift-phase">{readout.counter.phase}</span>
          <span className="lift-squares">
            {squareClasses(readout.counter).map((state, at) => <i key={at} className={state || undefined} />)}
          </span>
        </p>
      </div>
    </div>
  );
}
