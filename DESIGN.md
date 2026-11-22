---
name: Training Log
description: A training log typeset like a timetable. Black type on white; the only colour is the plates on the bar.
colors:
  ground: "#ffffff"
  wash: "#f3f3f1"
  ink: "#000000"
  ink-soft: "#46494e"
  ink-mute: "#666a70"
  hairline: "#c9cbcf"
  mark: "#ffee7a"
  plate-25: "#d4202b"
  plate-20: "#1d4fb5"
  plate-15: "#f4b800"
  plate-10: "#1a9a48"
  plate-5: "#ffffff"
  plate-2-5: "#1b1b1d"
  plate-1-25: "#8d959d"
  bar-steel: "#5d636a"
typography:
  display:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0em"
  body:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  small:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  column-head:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0em"
rounded:
  none: "0"
spacing:
  gutter: "1rem"
  gap: "0.75rem"
  margin-column: "4.75rem"
  margin-column-wide: "9rem"
  tap: "2.75rem"
  page: "62rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "0 1.1rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
  button-plain:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 1.1rem"
    height: "2.75rem"
  field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.5rem 0.7rem"
    height: "2.75rem"
  next-set-row:
    backgroundColor: "{colors.mark}"
    textColor: "{colors.ink}"
---

# Design System: Training Log

## Overview

The site is set like Swedish public-information print: a timetable or a sports results list. Black type on white, a wide left margin that carries weeks, dates and exercise numbers, and thin rules only where a table needs them. The numbers are the content, so they are written as lifters write them (`140 × 5 × 3`) and stacked in columns that compare down the page.

Weeks are the wayfinding. They are ISO weeks, named the Swedish way ("v. 47"), and every list is grouped by them.

Everything lives in `app/globals.css` (tokens, base elements, shared classes) and `app/ui/` (the plate drawing, set notation, weekday strip, icons, sheet). Page layout sits in a CSS module next to each area.

## Colors

### Neutral

Ink on ground does all the work. `ink-soft` is for secondary text and `ink-mute` for light figures and placeholders; both keep at least 4.5:1 on `ground`, `wash` and `mark`. `hairline` separates rows and `ink` rules open sections. `wash` is the resting fill for hovered controls and for messages.

### Primary

The plate colours are the only saturated colour on the site, and they always mean kilograms: 25 red, 20 blue, 15 yellow, 10 green, 5 white with an ink outline, 2.5 black, 1.25 steel. They appear only inside the loaded-bar drawing.

### Secondary

One highlighter yellow, `mark`. It is the single "you are here" stroke: today's date in a list, the session in progress on the desk, the next set in the logger. A screen carries at most one.

### Named Rules

- **Colour means kilograms.** Focus, errors and deleting are drawn in ink: a 3px ink ring, a dashed edge, a heavier weight. Red, blue, yellow and green never mark a state.
- **State is a mark, not only a hue.** A logged set is a solid square with a tick. Every state reads in greyscale.

## Typography

One family, Schibsted Grotesk, self-hosted through `next/font`. Weight 800 for the thing that matters (loads, titles, week numbers), 400 for the rest, 500 for column heads.

### Hierarchy

- `display` for page titles and the week number. It stays at the size of a strong heading, never a poster.
- `heading` for section and exercise names.
- `body` for text and inputs; inputs are never under 16px, so phones do not zoom.
- `small` and `column-head` for supporting lines and table heads.

### Named Rules

- **Tabular figures where numbers stack.** Use the `num` class. Decimals and clock times go through `<Num>` and `<Clock>`, which keep the point and the colon at their natural width.
- **Heavy text gets a wider word space.** The face sets a narrow space at weight 800; `word-spacing` opens it so words do not run together.
- No tracked capitals, no monospace, no label above a heading.

## Layout

Every list shares one grid: a margin column and a content column (`.row`). The margin carries the week, the date or the exercise number. A section opens with a 3px ink rule (`.row--section`); rows inside it are separated by hairlines. The page is one column up to 62rem; on a phone the margin column narrows and section headings stack above their content.

The same thing is always set in the same row format, so sessions and weeks compare vertically. Only real sequences are numbered: the exercises of a workout.

The session screen is a single 40rem column with its own top bar and no site masthead.

## Elevation & Depth

Flat. There are no shadows and no layers except the modal sheet, which sits on a dimmed backdrop under a 4px ink rule, and the rest timer bar fixed to the bottom of the session screen.

## Shapes

Square corners everywhere. A box is drawn only when it is a table cell, an input, a button, a sheet or a message. There are no cards.

## Components

### Buttons

`.btn` is solid ink with ground text; `.btn--plain` is the outline; `.btn--quiet` is an underlined text button. `.btn--danger` has a dashed ink edge for deleting. All are at least 44px tall.

### Inputs / Fields

`.field`, `.select`, `.textarea`: a 1px `ink-mute` edge that turns ink on hover and takes a 3px ink ring on focus. An invalid field has a dashed edge on `wash`. Choices of a few options use `.segments`, with the chosen one inverted.

### Navigation

The masthead is a 4px ink rule, the name, and three links (This week, All weeks, Journal); the current one is bold and underlined. Owner pages add a second ruled row of links below it.

### The loaded bar

`<BarLoad load barKg size>` draws a barbell load as plates on the bar: hard-edged blocks whose height and thickness step down with the weight, mirrored on both sleeves. Sizes: `inline` beside a table row, `row` beside a session, `tool` in the logger's call-out, `hero` across the content column. It is drawn only for barbell exercises whose load can be made from plates.

### Set notation

`<Notation measures tracking count>`: bold load, a light multiplication sign, light reps, RPE raised. Added weight on a bodyweight exercise reads `+10 × 6`, unloaded reps `BW × 12`, times `1:30`.

### Weekday strip

`<WeekStrip>` shows seven columns with the date in a solid square on trained days and a rule under today. `<WeekDots>` is the same week as seven small squares for long lists.

### Set row (session screen)

Set number, last time, inputs, done button. Logged: a solid square with a tick, the numbers settle to regular weight. Next: the row sits on `mark`, the set number is inverted, the inputs have 2px ink edges and show what a tap on done will log in ink, and barbell exercises show the plates per side underneath.

### Sheet

`<Sheet>` is the native dialog: from the bottom on a phone, centred on a desk.

## Do's and Don'ts

### Do:

- Write numbers as lifters write them and let them stack in columns.
- Put context in the margin column: the week, the date, the exercise number.
- Leave a section out when it has nothing to show. One session, or none, is a normal state.
- Name a button by what it does, and keep that name everywhere.

### Don't:

- Don't add a colour. Red, blue, yellow and green are plates.
- Don't put a second highlighter stroke on a screen.
- Don't box things into cards, round a corner, add a shadow or a gradient.
- Don't put a small label above a heading, track out capitals, or use a monospace face.
- Don't append arrows or other glyphs to links and buttons; icons come from `app/ui/icons.tsx` only.
- Don't use a stat tile (a big number over a small label), a progress ring or a decorative chart.
