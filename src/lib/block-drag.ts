// The arithmetic of carrying an exercise to another place in the list. Pure: it knows
// boxes and a pointer, not the page. The editor measures the boxes once when the
// block is picked up, in page coordinates, so scrolling while carrying changes nothing here.

export type Box = { top: number; height: number };

/** How close to the top or bottom edge the page starts to scroll by itself, in pixels. */
const EDGE_ZONE = 72;
/** The most the page scrolls in one frame. */
const EDGE_TOP_SPEED = 24;

/**
 * The place the carried block takes when dropped: its index in the list once it has moved.
 * It sits after every other block whose middle the pointer has passed, so a short block
 * and a tall one are each passed at their own middle. A pointer above the first block gives
 * 0 and below the last gives the last place.
 */
export function landingIndex(boxes: Box[], from: number, pointerY: number): number {
  let passed = 0;
  boxes.forEach((box, at) => {
    if (at !== from && box.top + box.height / 2 < pointerY) passed += 1;
  });
  return passed;
}

/**
 * How far each block is moved up (negative) or down (positive) to make room when the carried
 * block is to land at `to`. The carried block itself is 0 here: it follows the pointer.
 */
export function makeRoom(boxes: Box[], from: number, to: number): number[] {
  const gap = boxes.length > 1 ? boxes[1].top - (boxes[0].top + boxes[0].height) : 0;
  const slot = (boxes[from]?.height ?? 0) + gap;
  return boxes.map((_, at) => {
    if (to > from && at > from && at <= to) return -slot;
    if (to < from && at >= to && at < from) return slot;
    return 0;
  });
}

/**
 * Pixels to scroll this frame while a block is carried: negative is up, 0 is none. The page
 * scrolls within `EDGE_ZONE` of the top limit (under the sticky top bar) or the bottom limit,
 * faster the nearer the pointer is to the edge and at the top speed beyond it.
 */
export function edgeSpeed(pointerY: number, top: number, bottom: number): number {
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 3);
  if (zone <= 0) return 0;
  const above = zone - (pointerY - top);
  if (above > 0) return -Math.ceil(EDGE_TOP_SPEED * Math.min(above / zone, 1));
  const below = zone - (bottom - pointerY);
  if (below > 0) return Math.ceil(EDGE_TOP_SPEED * Math.min(below / zone, 1));
  return 0;
}

/**
 * The number each block shows once the carried one has landed at `to`, by its present place:
 * the others close up around the gap, so the numbers can follow the pointer before the drop.
 */
export function numbersAfter(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, at) => at).filter((at) => at !== from);
  order.splice(to, 0, from);
  const numbers: number[] = new Array(count);
  order.forEach((was, now) => { numbers[was] = now + 1; });
  return numbers;
}

/** Whether the blocks measured at pick-up are still the ones on the page, in the same order: a remote edit can change that mid-carry. */
export function sameList<T>(measured: ArrayLike<T>, now: ArrayLike<T>): boolean {
  return measured.length === now.length && Array.from(measured).every((one, at) => one === now[at]);
}

/** What the live region says after an exercise has moved. */
export function placeText(name: string, index: number, count: number): string {
  return `${name}, ${index + 1} of ${count}`;
}
