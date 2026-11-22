# Product

<!-- impeccable:product-schema 1 -->

Every fact below is read from the repository (README, schema, routes) unless marked *inferred*. Inferred facts were not confirmed in an interview; correct them when they are wrong.

## Platform

web

## Users

- **The owner (one person).** Plans sessions and logs every set from a phone in the gym, between sets, often one-handed and on a weak connection. Installs the site to the home screen and opens straight into the logger. Trains in Stockholm; dates follow Europe/Stockholm.
- **Visitors.** Anyone with the link. *Inferred:* training partners, friends and other lifters who want to see what was actually lifted, read on a phone or laptop.

## Product Purpose

A personal training log that is public by default. The owner defines workouts, logs sets as they happen, and each completed session is published with its exercises, sets, loads and effort, next to that morning's bodyweight, last night's sleep and resting heart rate. Success for the owner: logging a set takes one tap when the plan was followed. Success for a visitor: seeing a real session in full within seconds.

## Positioning

One lifter's real record, published as it happens: actual sets and loads beside the recovery data for the same day. Nothing is aggregated into a score.

## Operating Context

- Templates define a workout as an ordered list of exercises with target sets. A session starts from a template or blank, today or on a scheduled date.
- During a session the owner logs sets, adds or swaps exercises, and finishes the session, which publishes it.
- Withings supplies the first scale weight between 06:00 and 10:00. Google Health (Fitbit) supplies resting heart rate and main sleep duration. Manually entered day values take precedence.
- A journal carries longer notes and photos.
- Deployed on Heroku from `main`; the schema in `db/schema.sql` runs on every release.

## Capabilities and Constraints

- Single owner, signed in with Google. Every write checks ownership on the server.
- Loads are in kilograms, distances in metres, durations in seconds.
- Warm-up sets are recorded but excluded from working-set counts and volume.
- Custom set fields extend what a set records without a schema change.
- Publication of synced health data is switched per provider by deployment settings.
- PostgreSQL, Next.js App Router, React Server Components, no CSS framework.

## Brand Commitments

- Name: Training Log.
- The owner rejected the previous look (cream ground, forest green, oversized tight headings, tracked mono labels, bordered card grid, arrow glyphs on links) as reading machine-made. It is an anti-reference.

## Evidence on Hand

- Real data only: completed workouts, sets, daily vitals and journal posts from the database. The database is nearly empty today, so every public page must hold up with one session as well as with hundreds.
- No photography or illustration assets exist beyond the app icon. Journal photos are uploaded by the owner.
- Do not fabricate records, lifts, quotes or biography.

## Product Principles

1. The number is the content. Sets, loads and reps are shown as lifters write them.
2. Logging must never wait on the network.
3. Followed-the-plan is one tap; deviating is two.
4. The public page shows what happened, not a summary of it.
5. Sparse data is a normal state, not an empty state.

## Accessibility & Inclusion

Touch targets of at least 44 px in the logger, readable at arm's length, usable with one thumb. Keyboard reachable throughout. Contrast at WCAG AA or better. Motion respects reduced-motion settings.
