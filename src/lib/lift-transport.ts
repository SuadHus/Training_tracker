// What the play button and the page's visibility do to a set on show, as a pure state machine: the clock, whether it is playing,
// and when it is held. The browser feeds it events; it never reads the clock or the page itself.

export type Transport = {
  /** Seconds into the set. */
  t: number;
  duration: number;
  /** The time of the most telling still, where a finished set rests. */
  hero: number;
  /** Wants to play: the button reads Pause. */
  playing: boolean;
  /** Has been played since the set was shown. */
  started: boolean;
  /** The last frame has been played: the button reads Replay. */
  ended: boolean;
  /** The stage is on the screen. */
  visible: boolean;
  /** The tab is in the background. */
  tabHidden: boolean;
};

export type TransportEvent =
  | { type: "show"; duration: number; hero: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "visible"; value: boolean }
  | { type: "tabHidden"; value: boolean }
  | { type: "tick"; dt: number };

export const initialTransport: Transport = { t: 0, duration: 0, hero: 0, playing: false, started: false, ended: false, visible: true, tabHidden: false };

/** The clock only runs while it wants to play and somebody can see it. */
export const isMoving = (s: Transport) => s.playing && s.visible && !s.tabHidden;

/** The longest step of the clock: a tab that was away for a minute does not skip the set. */
export const MAX_STEP = 0.1;

/** The clock after an event: pure, so that the same events always give the same clock. */
export function transport(s: Transport, event: TransportEvent): Transport {
  switch (event.type) {
    // A new set rests on its still, not played; what the reader's eyes (visibility) and tab were doing stays.
    case "show": return { ...s, t: event.hero, duration: event.duration, hero: event.hero, playing: false, started: false, ended: false };
    case "play": {
      const restart = s.ended || !s.started || s.t >= s.duration;
      return { ...s, t: restart ? 0 : s.t, ended: restart ? false : s.ended, playing: true, started: true };
    }
    case "pause": return { ...s, playing: false };
    case "visible": return { ...s, visible: event.value };
    case "tabHidden": return { ...s, tabHidden: event.value };
    case "tick": {
      if (!isMoving(s)) return s;
      const t = s.t + Math.max(0, Math.min(MAX_STEP, event.dt));
      // The set is done: rest on its most telling still.
      return t >= s.duration ? { ...s, t: s.hero, playing: false, ended: true } : { ...s, t };
    }
  }
}

/** A set that nobody has asked to play starts by itself when it first comes into view, unless the reader asked for reduced motion. */
export const shouldAutoStart = (s: Transport, reducedMotion: boolean) => s.visible && !s.started && !s.playing && !reducedMotion;

/** The word on the button: what a press does. */
export const buttonWord = (s: Transport) => (s.playing ? "Pause" : s.ended ? "Replay" : "Play");
