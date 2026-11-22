import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GROUND, readTheme } from "../src/lib/theme";

// The colour tokens of the two themes are written out more than once in globals.css
// (CSS has no way to say "the same again"). These tests keep the copies in step and
// hold both themes to the contrast the design promises.

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

/** The custom properties declared in the first rule whose selector is exactly `selector`. */
function tokens(selector: string, from = 0): Record<string, string> {
  const at = css.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `no rule for ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const found: Record<string, string> = {};
  for (const [, name, value] of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z0-9-]+|color-scheme)\s*:\s*([^;]+);/g)) found[name] = value.trim();
  return found;
}

const paper = tokens(":root");
const nightByDevice = tokens(':root:not([data-theme="light"])');
const nightByChoice = tokens(':root[data-theme="dark"]');
const marked = tokens(".marked");
const colours = Object.keys(nightByChoice);

function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/, `${hex} is not a six-digit colour`);
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((value) => {
    const part = value / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("night is written the same for the device setting and for the reader's choice", () => {
  assert.deepEqual(nightByDevice, nightByChoice);
  assert.equal(nightByChoice["color-scheme"], "dark");
  assert.ok(colours.length >= 20);
});

test("every colour night changes exists on paper, and the highlighter scope restores paper exactly", () => {
  for (const name of colours) assert.ok(name in paper, `${name} is missing from :root`);
  for (const [name, value] of Object.entries(marked)) {
    assert.equal(value, paper[name], `${name} inside .marked differs from paper`);
  }
  // Everything night changes that can show inside a highlighted row is restored there.
  const shown = colours.filter((name) => !/^--(slab|on-slab)/.test(name) && name !== "--slab-line");
  for (const name of shown) assert.ok(name in marked, `${name} is not restored inside .marked`);
  // The highlighter itself is one yellow with black on it in both themes.
  assert.ok(!("--mark" in nightByChoice) && !("--on-mark" in nightByChoice));
});

test("the ground behind the browser chrome matches the page in both themes", () => {
  assert.equal(GROUND.light, paper["--ground"]);
  assert.equal(GROUND.dark, nightByChoice["--ground"]);
});

for (const [name, theme] of [["paper", paper], ["night", { ...paper, ...nightByChoice }]] as const) {
  test(`${name}: text and marks keep their contrast`, () => {
    const on = (token: string, ground: string) => contrast(theme[token], theme[ground]);
    // Body text and the two quieter inks, on the ground and on the wash behind inputs and alerts.
    for (const ground of ["--ground", "--wash"]) {
      assert.ok(on("--ink", ground) >= 15, `ink on ${ground}`);
      assert.ok(on("--ink-soft", ground) >= 7, `ink-soft on ${ground}: ${on("--ink-soft", ground)}`);
      assert.ok(on("--ink-mute", ground) >= 4.5, `ink-mute on ${ground}: ${on("--ink-mute", ground)}`);
    }
    // Field borders are drawn in ink-mute: a control's edge needs 3:1.
    assert.ok(on("--ink-mute", "--ground") >= 3);
    // A disabled button is soft ink on a hairline ground.
    assert.ok(on("--ink-soft", "--hairline") >= 4.5);
    // Plates and steel are graphics: 3:1 against the ground. Yellow on paper is the known
    // exception (the plate's height says 15 kg too); the plate that matches the ground has an edge.
    for (const plate of ["--plate-25", "--plate-20", "--plate-10", "--plate-1-25", "--bar-steel"]) {
      assert.ok(on(plate, "--ground") >= 3, `${plate} on ground: ${on(plate, "--ground")}`);
    }
    const edged = name === "paper" ? "--plate-5" : "--plate-2-5";
    assert.ok(on(edged, "--ground") < 1.3, `${edged} blends into the ground`);
    assert.ok(contrast(theme[`${edged}-edge`], theme["--ground"]) >= 15, `${edged} has a visible edge`);
    // The highlighter carries black text; the slab carries its own inks.
    assert.ok(contrast(theme["--on-mark"], theme["--mark"]) >= 15);
    assert.ok(on("--on-slab", "--slab") >= 15);
    assert.ok(on("--on-slab-soft", "--slab") >= 7);
  });
}

test("a theme cookie is only ever light or dark", () => {
  assert.deepEqual(["light", "dark", "auto", "", undefined, null, "Dark", "dark; x"].map(readTheme), ["light", "dark", "auto", "auto", "auto", "auto", "auto", "auto"]);
});
