import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GROUND, readTheme } from "../src/lib/theme";

// The colour tokens of the night theme are written twice in globals.css
// (once for the device setting, once for an explicit choice). These tests keep
// both copies in step and hold both themes to the contrast the design promises.

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
  assert.ok(colours.length >= 25);
});

test("every colour night changes exists on paper", () => {
  for (const name of colours) assert.ok(name in paper, `${name} is missing from :root`);
});

test("the ground behind the browser chrome matches the page in both themes", () => {
  assert.equal(GROUND.light, paper["--ground"]);
  assert.equal(GROUND.dark, nightByChoice["--ground"]);
});

for (const [name, theme] of [["paper", paper], ["night", { ...paper, ...nightByChoice }]] as const) {
  test(`${name}: text and marks keep their contrast`, () => {
    const on = (token: string, ground: string) => contrast(theme[token], theme[ground]);
    // Body text and the two quieter inks, on the ground, elevated surface, wash, and next-set band.
    for (const ground of ["--ground", "--surface", "--wash", "--mark-surface"]) {
      assert.ok(on("--ink", ground) >= 13, `ink on ${ground}: ${on("--ink", ground)}`);
      assert.ok(on("--ink-soft", ground) >= 7, `ink-soft on ${ground}: ${on("--ink-soft", ground)}`);
    }
    assert.ok(on("--ink", "--ground") >= 15, `ink on ground: ${on("--ink", "--ground")}`);
    for (const ground of ["--ground", "--surface", "--wash"]) {
      assert.ok(on("--ink-mute", ground) >= 4.5, `ink-mute on ${ground}: ${on("--ink-mute", ground)}`);
    }
    // Structural rules and control outlines need at least 3:1 against the ground.
    assert.ok(on("--rule", "--ground") >= 3, `rule on ground: ${on("--rule", "--ground")}`);
    assert.ok(on("--ink-mute", "--surface") >= 3, `ink-mute on surface: ${on("--ink-mute", "--surface")}`);
    // A disabled button is soft ink on a hairline ground.
    assert.ok(on("--ink-soft", "--hairline") >= 4.5, `ink-soft on hairline: ${on("--ink-soft", "--hairline")}`);
    // Plates and steel are graphics: 3:1 against the ground (and at night against the next-set band too).
    for (const plate of ["--plate-25", "--plate-20", "--plate-10", "--plate-1-25", "--bar-steel"]) {
      assert.ok(on(plate, "--ground") >= 3, `${plate} on ground: ${on(plate, "--ground")}`);
      if (name === "night") {
        assert.ok(on(plate, "--mark-surface") >= 3, `${plate} on mark-surface: ${on(plate, "--mark-surface")}`);
      }
    }
    const edged = name === "paper" ? "--plate-5" : "--plate-2-5";
    assert.ok(on(edged, "--ground") < 1.3, `${edged} blends into the ground`);
    assert.ok(contrast(theme[`${edged}-edge`], theme["--ground"]) >= 9, `${edged} has a visible edge`);
    // Highlights and the rest-timer slab keep high contrast.
    assert.ok(contrast(theme["--on-mark"], theme["--mark"]) >= 10, `on-mark on mark`);
    assert.ok(contrast(theme["--on-mark-accent"], theme["--mark-accent"]) >= 10, `on-mark-accent on mark-accent`);
    assert.ok(on("--on-slab", "--slab") >= 14, `on-slab on slab: ${on("--on-slab", "--slab")}`);
    assert.ok(on("--on-slab-soft", "--slab") >= 7, `on-slab-soft on slab: ${on("--on-slab-soft", "--slab")}`);
  });
}

test("a theme cookie is only ever light or dark", () => {
  assert.deepEqual(["light", "dark", "auto", "", undefined, null, "Dark", "dark; x"].map(readTheme), ["light", "dark", "auto", "auto", "auto", "auto", "auto", "auto"]);
});
