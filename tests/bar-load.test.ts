// The static bar of plates, which the stage's plates share a table with: it must keep drawing exactly as it did.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarLoad } from "../app/ui/bar-load";

const bar = (load: number, barKg = 20) => renderToStaticMarkup(createElement(BarLoad, { load, barKg, size: "row" }));

test("each of the seven plates is drawn with its own class, width and height", () => {
  const plates = [
    { kg: 25, className: "p-25", width: 6, height: 30 },
    { kg: 20, className: "p-20", width: 5, height: 30 },
    { kg: 15, className: "p-15", width: 4.5, height: 26 },
    { kg: 10, className: "p-10", width: 4, height: 21 },
    { kg: 5, className: "p-5", width: 3, height: 15 },
    { kg: 2.5, className: "p-2-5", width: 2.5, height: 12 },
    { kg: 1.25, className: "p-1-25", width: 2, height: 10 },
  ];
  for (const { kg, className, width, height } of plates) {
    const drawn = [...bar(20 + 2 * kg).matchAll(/<rect class="(p-[^"]+)" x="[^"]+" y="[^"]+" width="([^"]+)" height="([^"]+)"/g)]
      .map(([, name, wide, high]) => [name, Number(wide), Number(high)]);
    assert.deepEqual(drawn, [[className, width, height], [className, width, height]], `${kg} kg, once on each sleeve`);
  }
});

test("a loaded bar and an empty one are drawn as they always were", () => {
  assert.equal(
    bar(182.5),
    '<svg class="bar bar--row" viewBox="0 0 118 32" width="118" height="32" role="img" aria-label="182.5 kg: bar 20 kg, per side 25 + 25 + 25 + 5 + 1.25">' +
    '<rect class="bar-steel" x="0" y="14.25" width="44" height="3.5"></rect><rect class="bar-steel" x="74" y="14.25" width="44" height="3.5"></rect>' +
    '<rect class="bar-steel" x="44" y="15" width="30" height="2"></rect><rect class="bar-steel" x="41.5" y="11.5" width="2.5" height="9"></rect>' +
    '<rect class="bar-steel" x="74" y="11.5" width="2.5" height="9"></rect>' +
    '<rect class="p-25" x="77.25" y="1" width="6" height="30"></rect><rect class="p-25" x="34.75" y="1" width="6" height="30"></rect>' +
    '<rect class="p-25" x="84" y="1" width="6" height="30"></rect><rect class="p-25" x="28" y="1" width="6" height="30"></rect>' +
    '<rect class="p-25" x="90.75" y="1" width="6" height="30"></rect><rect class="p-25" x="21.25" y="1" width="6" height="30"></rect>' +
    '<rect class="p-5" x="97.5" y="8.5" width="3" height="15"></rect><rect class="p-5" x="17.5" y="8.5" width="3" height="15"></rect>' +
    '<rect class="p-1-25" x="101.25" y="11" width="2" height="10"></rect><rect class="p-1-25" x="14.75" y="11" width="2" height="10"></rect>' +
    '<rect class="bar-steel" x="104" y="12.5" width="3" height="7"></rect><rect class="bar-steel" x="11" y="12.5" width="3" height="7"></rect></svg>',
  );
  assert.ok(!bar(20).includes("p-"), "an empty bar has no plate");
  assert.match(bar(20), /aria-label="20 kg: bar 20 kg, nothing loaded"/);
});

test("a load the plates cannot make draws nothing", () => {
  assert.equal(bar(61), "");
});
