---
name: Training Log
description: A training log typeset like a timetable. Black type on white, or its negative at night; the only colour is the plates on the bar.
colors:
  ground: "#ffffff"
  wash: "#f3f3f1"
  ink: "#000000"
  ink-soft: "#46494e"
  ink-mute: "#666a70"
  hairline: "#c9cbcf"
  mark: "#ffee7a"
  on-mark: "#000000"
  plate-25: "#d4202b"
  plate-20: "#1d4fb5"
  plate-15: "#f4b800"
  plate-10: "#1a9a48"
  plate-5: "#ffffff"
  plate-2-5: "#1b1b1d"
  plate-1-25: "#8d959d"
  bar-steel: "#5d636a"
  slab: "#000000"
  on-slab: "#ffffff"
  night-ground: "#111214"
  night-surface: "#181a1e"
  night-wash: "#1e2025"
  night-ink: "#eceef0"
  night-ink-soft: "#adb3bc"
  night-ink-mute: "#858c96"
  night-rule: "#5f6672"
  night-hairline: "#2a2d33"
  night-mark: "#e5c64b"
  night-mark-surface: "#262316"
  night-plate-25: "#e5484d"
  night-plate-20: "#4c7ef0"
  night-plate-15: "#eab618"
  night-plate-10: "#2fb162"
  night-plate-5: "#e6e8ec"
  night-plate-2-5: "#202328"
  night-plate-1-25: "#9aa2ad"
  night-bar-steel: "#7f8792"
  night-slab: "#1c1e23"
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

On the home page the loud element is the lifter: when the week holds one of the six main lifts, the top of the week is that lift drawn in motion with the real load and reps, and nothing else on the page moves. A week without one of them opens with the heaviest bar as plates, as the other pages draw it.

Everything lives in `app/globals.css` (tokens, base elements, shared classes) and `app/ui/` (the plate drawing, the lifter, set notation, weekday strip, icons, sheet). Page layout sits in a CSS module next to each area.

## Colors

### Neutral

Ink on ground does all the work. `ink-soft` is for secondary text and `ink-mute` for light figures and placeholders; both keep at least 4.5:1 on `ground` and `wash` in both themes, and on `mark` in their paper values. `hairline` separates rows and `ink` rules open sections. `wash` is the resting fill for hovered controls and for messages.

### Primary

The plate colours are the only saturated colour on the site, and they always mean kilograms: 25 red, 20 blue, 15 yellow, 10 green, 5 white with an ink outline, 2.5 black, 1.25 steel. They appear only on plates: in the loaded-bar drawing and on the bar the lifter holds.

### Secondary

One highlighter yellow, `mark`. It is the single "you are here" stroke: today's date in a list, the session in progress on the desk, the next set in the logger. A screen carries at most one.

### Night

The second theme is a deep charcoal slate (`#111214`) with soft off-white type (`#eceef0`) and muted graphite rules (`#5f6672`), built for a dim gym and a phone held between sets without pure-black halation or blinding white borders. Inputs, sheets and menus lift gently onto `--surface` (`#181a1e`). Nothing structural changes; the same tokens carry night values so every rule, table and control follows automatically.

- The plate colours are tuned to stay crisp against charcoal without glare. The white plate loses its outline and the black 2.5 kg plate gains a soft steel edge: whichever plate matches the ground gets the edge.
- Compact highlights (today's date, current week or session) use a warmer, less glaring gold (`#e5c64b`) with dark ink. The full-width next-set row in the session logger uses a quiet dark-amber band (`#262316`) with a gold top edge, gold set-number badge, and dark inputs so it never flashes bright yellow or white in a dark room.
- The rest timer sits on `--slab` (`#1c1e23`), cleanly separated from the page ground.

The page follows the device unless the reader picks a theme: three words in the footer, Auto, Light and Dark. A choice is kept in a `theme` cookie and rendered into `<html data-theme>` by the server, so no page flashes the other theme and no script runs in the head. The session screen has no footer and takes the same choice.

The night colour tokens are written twice in `app/globals.css` (for the device setting and for an explicit choice). `tests/theme-tokens.test.ts` keeps both copies identical and holds both themes to their contrast.

### Named Rules

- **Colour means kilograms.** Focus, errors and deleting are drawn in ink: a 3px ink ring, a dashed edge, a heavier weight. Red, blue, yellow and green never mark a state.
- **State is a mark, not only a hue.** A logged set is a solid square with a tick. Every state reads in greyscale.
- **Tokens only.** No module writes a colour. A value that is not a token cannot follow the theme.

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

Flat. There are no shadows and no layers (the lifter is flat too: one tone per part, a halo of ground colour round it, no shading) except the modal sheet, which sits on a dimmed backdrop under a 4px ink rule, and the rest timer, a `slab` fixed to the bottom of the session screen.

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

### The lifter

`<LiftStage lifts>` draws the week's main lifts as a jointed figure lifting the real bar: low bar squat, high bar squat, bench press, close grip bench press, conventional deadlift and sumo deadlift. It shows the heaviest working set of each lift this week, heaviest first, with the load, the reps and the plates of that set. A set that cannot be drawn truthfully (a load the plates cannot make, no reps) is left out, and so is an exercise whose name might be another lift; the wrong movement on a public page is worse than a still bar. The row sits under the margin label "Main lifts" ("Main lift" for one).

- **Tones.** Flat shapes in tokens only. Near limbs `ink`, far limbs `ink-mute`, the head `ink-soft`, the torso `hairline`, the quietest: the order is the same in both themes, so an arm in front of the torso still reads at night. Rack and bench are single hairline outlines, the floor one rule. The plates are the site's plates in the site's colours and are the only colour on the page.
- **Two views.** The main view is a three-quarter view (from the side and front for the squat and deadlift, from the head end for the bench); beside it, or under it on a phone, the front elevation with the word "Front" under its floor rule, drawn at 12 to 14.5px at every width (its size in the drawing steps with the figure's width, in the stylesheet). On a desk both views share one scale and one floor rule; on a phone the main view takes the column and the front view is a strip under a hairline. The stylesheet picks the size with a container query, so the row has its real height before any script runs. All six lifts share one stage size, so nothing moves when the lift changes.
- **Plates.** Round, with hubs and collars, in the colours and the order of the loaded bar. The thickness is exaggerated so that colours read and a stack can be counted; a stack too long for the sleeve is squeezed, and a plate too thin to outline loses its outline.
- **Controls.** Tabs only when the week has more than one lift: text buttons set like the navigation and the theme switch, the chosen one bold and underlined. Under the drawing, a `btn--plain` button that says what a press does (Play, Pause, Replay) and a small counter, "Rep 3 of 5" with the phase in words and a square for each rep, solid when done. A set of more than ten reps has the words only, since a row cut short would look finished, and on a narrow phone the phase is cut with an ellipsis before the page is made wider. The caption reads as a set reads everywhere: the exercise, the load and reps in notation with the RPE raised, the day, and the plates per side. Every lift's caption sits in one grid cell and only the chosen one is seen and read out, so the row is as tall as the tallest caption and nothing moves when the lift changes.
- **Behaviour.** The set starts at the rack (a deadlift: the lifter walks up to the bar) and plays once when it scrolls into view, then rests on its most telling still with the button reading Replay. It stops while it is off screen or the tab is hidden and goes on when it is back. A tab the reader chooses plays at once.
- **Reduced motion.** With `prefers-reduced-motion: reduce` nothing moves by itself: the drawing shows the still, a chosen tab shows its still, and Play plays the set when it is pressed.
- **Reading it without seeing it.** The drawing is an image with a sentence that names the lift, the load, the reps, the plates and how the lift starts; the rep counter is hidden from screen readers, since the caption says it all.

### Set notation

`<Notation measures tracking count>`: bold load, a light multiplication sign, light reps, RPE raised. Added weight on a bodyweight exercise reads `+10 × 6`, unloaded reps `BW × 12`, times `1:30`.

### Weekday strip

`<WeekStrip>` shows seven columns with the date in a solid square on trained days and a rule under today. `<WeekDots>` is the same week as seven small squares for long lists.

### Set row (session screen)

Set number, last time, inputs, done button. Every control is named with its exercise and set ("Bench press, Set 2 kg"). Logged: a solid square with a tick, the numbers settle to regular weight. Next: the row sits on `mark`, the set number is inverted, the inputs have 2px ink edges and show what a tap on done will log in ink, and barbell exercises show the plates per side underneath.

### Sheet

`<Sheet>` is the native dialog: from the bottom on a phone, centred on a desk. On opening, focus goes to the safe answer of a question (`data-autofocus`), else to the first field when there is a keyboard and a mouse. On a touch screen it stays on Close, so the keyboard does not cover the sheet before it is read.

### Theme switch

`<ThemeSwitch>` in the footer: the word Theme and three text buttons. The chosen one is bold with the same heavy underline as the current page in the navigation.

## Do's and Don'ts

### Do:

- Write numbers as lifters write them and let them stack in columns.
- Put context in the margin column: the week, the date, the exercise number.
- Leave a section out when it has nothing to show. One session, or none, is a normal state: one main lift has no tabs, and none leaves the static bar.
- Draw the lifter only from a set that was logged, with its real load and reps.
- Name a button by what it does, and keep that name everywhere.

### Don't:

- Don't add a colour, and don't write one outside the tokens. Red, blue, yellow and green are plates.
- Don't put a second highlighter stroke on a screen.
- Don't box things into cards, round a corner, add a shadow or a gradient.
- Don't put a small label above a heading, track out capitals, or use a monospace face.
- Don't append arrows or other glyphs to links and buttons; icons come from `app/ui/icons.tsx` only.
- Don't move anything but the lifter, and don't start it where it cannot be seen: it plays when on screen and stops when not.
- Don't use a stat tile (a big number over a small label), a progress ring or a decorative chart.
