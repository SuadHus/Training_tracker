---
version: 1
slug: "app-site-page-tsx"
primary_target: "app/(site)/page.tsx"
related_targets: ["app/(session)/admin/workouts/[id]/page.tsx","app/(site)/(owner)/admin/page.tsx"]
---

# Whole-site redesign (public log, owner desk, session screen)

Scope: every route. Modes: Read for the public log and journal, Operate for the owner's desk, library and session screen.
Audience and job: visitors want to see what was lifted, fast, on a phone; the owner logs sets one-handed between sets on a weak connection.
Constraints: real data only; the database may hold one session or hundreds; no photography; light theme (bright gym strip lighting, a phone at arm's length).
Chosen without an interview: the owner asked for the redesign to be built and pushed without check-ins, so product truth was read from the repository and the direction was taken from the roll.

## Direction contract

THESIS: A training log typeset like a Swedish timetable or results list: the numbers are the page. It refuses the category's two defaults, the dark fitness dashboard with stat tiles and the cream editorial journal.

OWN-WORLD: White ground, black type, one grotesque (Schibsted Grotesk) in heavy and regular weights, square corners, thin rules only where a table needs them, a wide left margin column carrying weeks ("v. 47"), dates and exercise numbers. The only saturated colour is the calibrated plate colours (25 red, 20 blue, 15 yellow, 10 green, 5 white, 2.5 black, 1.25 steel), and it always means kilograms. One highlighter yellow marks "you are here". No cards, no eyebrow labels, no arrow glyphs, no gradients.

STORY: A visitor understands in one screen which days were trained this week and what was lifted, believes it because every set is written out, and opens a session to read it in full. The owner opens the desk, starts a session in one tap, and marks sets done without waiting on the network.

FIRST VIEWPORT: Masthead rule and nav; the current ISO week number in the margin with its date range; a seven-column weekday strip with trained days as solid squares and one sentence of week totals; directly under it the week's heaviest barbell set drawn as a loaded bar across the full content column, the single loud element; then the first session rows. There is no hero headline and no call to action: the log itself is the opening.

FORM: Swedish public-information print (timetable and results list) organised by ISO week, candidate 7 of 7 on the ordered list; seed:f74550213444a9ee. Raised by the declined challengers: one row format repeated so weeks compare vertically; colour committed in hard-edged blocks locked to the grid; no enclosure; numbering only for real sequences; state carried by a mark, not only a hue.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
