// The browser's half of the drawing, on fake nodes: it adopts only the nodes of its own drawing, writes only what changed from one frame
// to the next, and moves nodes only when the paint order changes.
import assert from "node:assert/strict";
import test from "node:test";
import type { Drawing, Prim } from "../src/lib/lift-draw";
import { SvgDrawing } from "../app/ui/lift-svg";

class FakeNode {
  readonly writes: string[] = [];
  constructor(readonly key: string, readonly attrs: Record<string, string>) {}
  getAttribute(name: string) { return name === "data-k" ? this.key : this.attrs[name] ?? null; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; this.writes.push(`${name}=${value}`); }
}

class FakeSvg {
  moves = 0;
  /** How often the order of the children was looked at: an update with an unchanged paint order does not look. */
  looks = 0;
  constructor(readonly children: FakeNode[]) {}
  get childNodes() { this.looks += 1; return this.children; }
  insertBefore(node: FakeNode, before: FakeNode | null) {
    this.moves += 1;
    this.children.splice(this.children.indexOf(node), 1);
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
  }
}

const prim = (id: string, attrs: Record<string, string>): Prim => ({ id, el: "path", cls: "lf-ink", part: "leg", view: "main", attrs });
const drawing = (...prims: Prim[]): Drawing => ({ width: 100, height: 100, viewBox: "0 0 100 100", prims });
const first = () => drawing(prim("floor", { d: "M0 0" }), prim("leg", { d: "M1 1" }), prim("bar", { d: "M2 2", opacity: "1" }));

function mount(frame: Drawing = first()) {
  const nodes = frame.prims.map((p) => new FakeNode(p.id, { ...p.attrs }));
  const svg = new FakeSvg(nodes);
  return { svg, nodes, adopted: SvgDrawing.adopt(svg as unknown as SVGSVGElement, frame) };
}
const order = (svg: FakeSvg) => svg.children.map((node) => node.key);

test("it adopts the nodes that are its first frame, in order", () => {
  assert.ok(mount().adopted instanceof SvgDrawing);
});

test("it refuses nodes that are not the drawing's, and touches nothing", () => {
  const frame = first();
  const refusals: Array<[string, FakeNode[]]> = [
    ["fewer nodes", [new FakeNode("floor", { d: "M0 0" }), new FakeNode("leg", { d: "M1 1" })]],
    ["more nodes", [...mount().nodes, new FakeNode("extra", {})]],
    ["another id", [new FakeNode("floor", {}), new FakeNode("leg", {}), new FakeNode("arm", {})]],
    ["the same ids in another order", [new FakeNode("leg", {}), new FakeNode("floor", {}), new FakeNode("bar", {})]],
    ["no nodes", []],
  ];
  for (const [what, nodes] of refusals) {
    const svg = new FakeSvg(nodes);
    assert.equal(SvgDrawing.adopt(svg as unknown as SVGSVGElement, frame), null, what);
    assert.equal(svg.moves, 0, what);
    assert.deepEqual(nodes.flatMap((node) => node.writes), [], what);
  }
});

test("a frame equal to what is on the nodes writes nothing", () => {
  const { adopted, nodes, svg } = mount();
  adopted!.update(first());
  adopted!.update(first());
  assert.deepEqual(nodes.flatMap((node) => node.writes), []);
  assert.equal(svg.moves, 0);
});

test("a frame writes the attributes that changed and no others, and remembers them", () => {
  const { adopted, nodes } = mount();
  const moved = () => drawing(prim("floor", { d: "M0 0" }), prim("leg", { d: "M9 9" }), prim("bar", { d: "M2 2", opacity: "0.5" }));
  adopted!.update(moved());
  assert.deepEqual(nodes.map((node) => node.writes), [[], ["d=M9 9"], ["opacity=0.5"]]);
  adopted!.update(moved());
  assert.deepEqual(nodes.map((node) => node.writes.length), [0, 1, 1], "the same frame again writes nothing");
});

test("what is on a node when it is adopted counts as what was written: a frame that says the same writes nothing", () => {
  const frame = drawing(prim("leg", { d: "M1 1" }));
  const { adopted, nodes } = mount(frame);
  adopted!.update(drawing(prim("leg", { d: "M1 1" })));
  assert.deepEqual(nodes[0].writes, []);
});

test("nodes are moved only when the paint order changes, and then to the new order", () => {
  const { adopted, svg } = mount();
  const frame = (...ids: string[]) => drawing(...ids.map((id) => prim(id, { d: id })));
  adopted!.update(first());
  assert.deepEqual([svg.moves, svg.looks], [0, 0], "the same order moves nothing and does not even look at the children");
  adopted!.update(frame("floor", "bar", "leg"));
  assert.deepEqual(order(svg), ["floor", "bar", "leg"]);
  const [moves, looks] = [svg.moves, svg.looks];
  assert.ok(moves > 0);
  adopted!.update(frame("floor", "bar", "leg"));
  assert.deepEqual([svg.moves, svg.looks], [moves, looks], "the new order is the one it remembers");
  adopted!.update(frame("leg", "floor", "bar"));
  assert.deepEqual(order(svg), ["leg", "floor", "bar"]);
});

test("a frame with other shapes than the first is not drawn", () => {
  const { adopted, nodes, svg } = mount();
  adopted!.update(drawing(prim("floor", { d: "M5 5" }), prim("leg", { d: "M5 5" })));
  adopted!.update(drawing(prim("floor", { d: "M5 5" }), prim("leg", { d: "M5 5" }), prim("other", { d: "M5 5" })));
  assert.deepEqual(nodes.flatMap((node) => node.writes), []);
  assert.equal(svg.moves, 0);
});
