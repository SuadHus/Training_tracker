import type { Drawing } from "@/src/lib/lift-draw";

type Slot = { node: SVGElement; attrs: Record<string, string> };

/**
 * The browser's half of a drawing. React writes the first frame (each shape carries its id in `data-k`); this takes those nodes over and,
 * frame after frame, changes only the attributes that changed. Nodes are reordered only when the paint order changes. Nothing is parsed
 * and nothing is made: React never sees a moving shape, because it never renders this drawing again.
 */
export class SvgDrawing {
  private order: string[];

  private constructor(private readonly svg: SVGSVGElement, private readonly slots: Map<string, Slot>, order: string[]) {
    this.order = order;
  }

  /** Takes over the nodes of the first frame, which `drawing` must be. Null, touching nothing, when they are not that drawing's nodes. */
  static adopt(svg: SVGSVGElement, drawing: Drawing): SvgDrawing | null {
    const nodes = Array.from(svg.children) as SVGElement[];
    const prims = drawing.prims;
    if (nodes.length !== prims.length || nodes.some((node, at) => node.getAttribute("data-k") !== prims[at].id)) return null;
    const slots = new Map<string, Slot>();
    prims.forEach((prim, at) => {
      const attrs: Record<string, string> = {};
      for (const name in prim.attrs) attrs[name] = nodes[at].getAttribute(name) ?? "";
      slots.set(prim.id, { node: nodes[at], attrs });
    });
    return new SvgDrawing(svg, slots, prims.map((prim) => prim.id));
  }

  /** Brings the nodes to this frame of the same set. A frame with other shapes than the first is not drawn. */
  update(drawing: Drawing): void {
    const prims = drawing.prims;
    if (prims.length !== this.slots.size || prims.some((prim) => !this.slots.has(prim.id))) return;
    let reorder = false;
    prims.forEach((prim, at) => {
      const slot = this.slots.get(prim.id)!;
      for (const name in prim.attrs) {
        const value = prim.attrs[name];
        if (slot.attrs[name] !== value) {
          slot.node.setAttribute(name, value);
          slot.attrs[name] = value;
        }
      }
      if (this.order[at] !== prim.id) reorder = true;
    });
    if (!reorder) return;
    prims.forEach((prim, at) => {
      const node = this.slots.get(prim.id)!.node;
      if (this.svg.childNodes[at] !== node) this.svg.insertBefore(node, this.svg.childNodes[at] ?? null);
      this.order[at] = prim.id;
    });
  }
}
