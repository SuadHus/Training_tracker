import assert from "node:assert/strict";
import test from "node:test";
import { edgeSpeed, landingIndex, makeRoom, numbersAfter, placeText, sameList, type Box } from "../src/lib/block-drag";

// Boxes as the editor measures them: top and height in page coordinates, one under the other, touching.
const stack = (...heights: number[]): Box[] => {
  let top = 100;
  return heights.map((height) => {
    const box = { top, height };
    top += height;
    return box;
  });
};

test("a block carried over its own box stays where it is", () => {
  const boxes = stack(200, 200, 200);
  for (let from = 0; from < boxes.length; from += 1) {
    const { top, height } = boxes[from];
    assert.equal(landingIndex(boxes, from, top + 1), from);
    assert.equal(landingIndex(boxes, from, top + height / 2), from);
    assert.equal(landingIndex(boxes, from, top + height - 1), from);
  }
});

test("a pointer above the first block lands first, and below the last lands last", () => {
  const boxes = stack(150, 300, 120, 220);
  for (let from = 0; from < boxes.length; from += 1) {
    assert.equal(landingIndex(boxes, from, -500), 0);
    assert.equal(landingIndex(boxes, from, 100), 0);
    assert.equal(landingIndex(boxes, from, 5000), boxes.length - 1);
  }
});

test("a block passes its neighbour when the pointer crosses that neighbour's middle", () => {
  const boxes = stack(200, 200, 200);
  // Carrying the first block down: the second block's middle is at 400.
  assert.equal(landingIndex(boxes, 0, 399), 0);
  assert.equal(landingIndex(boxes, 0, 400), 0);
  assert.equal(landingIndex(boxes, 0, 401), 1);
  assert.equal(landingIndex(boxes, 0, 601), 2);
  // Carrying the last block up: the second block's middle is at 400, the first block's at 200.
  assert.equal(landingIndex(boxes, 2, 401), 2);
  assert.equal(landingIndex(boxes, 2, 399), 1);
  assert.equal(landingIndex(boxes, 2, 199), 0);
});

test("tall and short blocks mixed: the pointer decides by each block's own middle", () => {
  // Tops 100, 400, 500, 800; middles 250, 450, 650, 850.
  const boxes = stack(300, 100, 300, 100);
  // A tall block carried down over a short one, then over a tall one.
  assert.equal(landingIndex(boxes, 0, 440), 0);
  assert.equal(landingIndex(boxes, 0, 460), 1);
  assert.equal(landingIndex(boxes, 0, 640), 1);
  assert.equal(landingIndex(boxes, 0, 660), 2);
  assert.equal(landingIndex(boxes, 0, 860), 3);
  // A short block carried up over a tall one: its middle is 250.
  assert.equal(landingIndex(boxes, 1, 260), 1);
  assert.equal(landingIndex(boxes, 1, 240), 0);
  // A short block at the end carried up over a tall one, a short one and a tall one.
  assert.equal(landingIndex(boxes, 3, 700), 3);
  assert.equal(landingIndex(boxes, 3, 640), 2);
  assert.equal(landingIndex(boxes, 3, 440), 1);
  assert.equal(landingIndex(boxes, 3, 240), 0);
});

test("one block, or none, has nowhere else to land", () => {
  assert.equal(landingIndex(stack(200), 0, -10), 0);
  assert.equal(landingIndex(stack(200), 0, 9000), 0);
  assert.equal(landingIndex([], 0, 50), 0);
});

test("the others make room by the height of the carried block", () => {
  const boxes = stack(300, 100, 200, 100);
  assert.deepEqual(makeRoom(boxes, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(makeRoom(boxes, 0, 2), [0, -300, -300, 0]);
  assert.deepEqual(makeRoom(boxes, 3, 1), [0, 100, 100, 0]);
  assert.deepEqual(makeRoom(boxes, 1, 3), [0, 0, -100, -100]);
  assert.deepEqual(makeRoom(boxes, 2, 0), [200, 200, 0, 0]);
});

test("room includes a gap between blocks, so nothing lands on its neighbour", () => {
  const apart: Box[] = [{ top: 0, height: 100 }, { top: 110, height: 200 }, { top: 320, height: 50 }];
  assert.deepEqual(makeRoom(apart, 0, 1), [0, -110, 0]);
  assert.deepEqual(makeRoom(apart, 2, 0), [60, 60, 0]);
});

test("the rooms agree with where the block lands: moving there and back gives the same order", () => {
  const boxes = stack(300, 100, 200, 100, 250);
  for (let from = 0; from < boxes.length; from += 1) {
    for (let to = 0; to < boxes.length; to += 1) {
      const order = boxes.map((_, at) => at);
      const [carried] = order.splice(from, 1);
      order.splice(to, 0, carried);
      // Everything but the carried block ends up at the top the new order gives it.
      const room = makeRoom(boxes, from, to);
      let top = boxes[0].top;
      for (const at of order) {
        if (at !== from) assert.equal(boxes[at].top + room[at], top, `block ${at}, ${from} to ${to}`);
        top += boxes[at].height;
      }
    }
  }
});

test("the page scrolls by itself near the top and bottom edge, and only there", () => {
  assert.equal(edgeSpeed(400, 80, 800), 0);
  assert.ok(edgeSpeed(85, 80, 800) < 0);
  assert.ok(edgeSpeed(790, 80, 800) > 0);
  assert.ok(edgeSpeed(81, 80, 800) < edgeSpeed(130, 80, 800));
  assert.ok(edgeSpeed(795, 80, 800) > edgeSpeed(760, 80, 800));
  assert.ok(edgeSpeed(795, 80, 800) > 0 && edgeSpeed(760, 80, 800) > 0);
});

test("a pointer outside the screen scrolls at the top speed, never faster", () => {
  const top = edgeSpeed(-300, 80, 800);
  const bottom = edgeSpeed(2000, 80, 800);
  assert.equal(top, -bottom);
  assert.equal(edgeSpeed(80, 80, 800), top);
  assert.equal(edgeSpeed(800, 80, 800), bottom);
  assert.ok(bottom > 0 && bottom <= 30);
});

test("a short window does not scroll on both edges at once", () => {
  assert.equal(edgeSpeed(100, 80, 140), 0);
  assert.equal(edgeSpeed(110, 80, 140), 0);
  assert.equal(edgeSpeed(100, 100, 100), 0);
});

test("the live region says where the exercise is now", () => {
  assert.equal(placeText("Bench press", 1, 5), "Bench press, 2 of 5");
  assert.equal(placeText("Squat", 0, 1), "Squat, 1 of 1");
});

test("the numbers follow the carried block: each block's number once the move is made", () => {
  assert.deepEqual(numbersAfter(5, 1, 1), [1, 2, 3, 4, 5]);
  assert.deepEqual(numbersAfter(5, 1, 3), [1, 4, 2, 3, 5]);
  assert.deepEqual(numbersAfter(5, 3, 1), [1, 3, 4, 2, 5]);
  assert.deepEqual(numbersAfter(5, 4, 0), [2, 3, 4, 5, 1]);
  assert.deepEqual(numbersAfter(5, 0, 4), [5, 1, 2, 3, 4]);
  assert.deepEqual(numbersAfter(1, 0, 0), [1]);
});

test("the list measured at pick-up is the list on the page only while the same blocks stand in the same order", () => {
  const [a, b, c] = ["a", "b", "c"];
  assert.equal(sameList([a, b, c], [a, b, c]), true);
  assert.equal(sameList([a, b, c], [a, b]), false);
  assert.equal(sameList([a, b], [a, b, c]), false);
  assert.equal(sameList([a, b, c], [a, c, b]), false);
  assert.equal(sameList([a, b, c], [a, b, "d"]), false);
  assert.equal(sameList([], []), true);
});
