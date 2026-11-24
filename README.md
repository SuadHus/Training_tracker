# Training Log

A public training log for one lifter. The owner defines workouts, logs every set from a phone, and each finished session is published with its exercises, sets and loads next to that morning's bodyweight, sleep and resting heart rate. Today's morning vitals and upcoming planned sessions also appear on the home page every day, even on rest days. Dates use Europe/Stockholm, and weeks are ISO weeks ("v. 47").

## Local development

Requires Node.js 22.13+ and PostgreSQL. Docker Compose starts a local database on port 55481.

```sh
npm ci
cp .env.example .env.local
docker compose up -d db
npm run db:init
npm run dev
```

Open http://localhost:3000. The public site works with an empty database. Open `/admin` after setting up Google sign-in. On a phone, add the HTTPS site to your home screen: it opens straight on the desk.

For a database with eight weeks of realistic training to look at, load the fixture into an empty database and run `npm run db:init` on top:

```sh
psql "$DATABASE_URL" -f tests/fixtures/legacy.sql
npm run db:init
```

## How a workout is defined

A workout is an ordered list of exercises, and each exercise holds its sets. Templates, planned sessions and completed sessions all share that shape and the same editor.

- **Exercises** live in the library (**Exercises**). Each one says what a set of it records (weight and reps, bodyweight reps, time, or distance and time), what it is loaded with, and its default rest. Barbell exercises get their loads drawn as plates on the bar. *Add the common lifts* fills an empty library in one step. Exercises that have history are archived, not deleted.
- **Templates** are workouts you repeat. Give each exercise its target sets: reps or a range such as 8–12, a load, a target RPE, warm-up sets, rest and notes. Start a template from the desk in one tap, or plan it for another day.
- **Import from a spreadsheet** (under Templates) turns rows copied from Excel or Sheets into templates: one exercise per row with sets, reps and a load, an RPE or a remark. Workouts side by side and weeks stacked under each other become separate templates, and exercises the library does not know are added. A remark on a row becomes a note on the exercise, and notes are published with a session once it is finished.
- **Order.** When planning (a template, a session on a later day, or today's session until its first set is done) each exercise has a grip in its header: drag it, with a finger, a pen or a mouse, to change the order, or press Arrow Up or Arrow Down with the grip focused. The menu's *Move up* and *Move down* work in both planning and logging; the grip goes once a set is logged, where a stray drag costs more than it gives.
- **Extra set fields** add something to record on a set, such as bar speed, for every exercise or for one.

## The animated main lifts

The top of the home page shows the week's main lifts as a figure lifting the real bar, with the heaviest working set of each lift this week, its plates and its reps. A week with none of them shows the heaviest bar as plates, and the other pages keep the plates.

An exercise is drawn as one of six lifts by its name, and only if it is a barbell exercise. The rule is strict (`liftKind` in `src/lib/lifts.ts`): the name must be one of these lifts and say nothing else that changes the movement. The exercise editor shows which lift a name will be drawn as.

- **Low bar squat**: "Low bar squat", "Low-bar squat", "LBBS", "Squat (low bar)". **High bar squat**: "High bar squat", "HBBS". A plain "Squat" or "Back squat" is drawn as a high bar squat.
- **Bench press**: "Bench press", "Bench". **Close grip bench press**: "Close grip bench press", "CGBP", "Close-grip bench".
- **Conventional deadlift**: "Conventional deadlift". **Sumo deadlift**: "Sumo deadlift". A plain "Deadlift" is drawn as a conventional deadlift.
- Words that do not change the picture are let through: "Paused squat", "Low bar squat 3ct", "Bench press (touch and go)".
- Not drawn: "Front squat", "Incline bench press", "Romanian deadlift", "Trap bar deadlift", "Deficit deadlift", a name that asks for two lifts at once ("Squat / bench"), a name with a fraction or a decimal ("1 1/2 squat"), and any exercise that is not loaded with a barbell.

A set is drawn only when its load can be made from plates and it has between one and 30 reps. The lifter's movement is a model that is the same for every load; the load, the reps and the plates are the logged ones.

The stage of each lift (where it is drawn, at what size) is planned ahead of time and stored in `src/lib/lift-plans.ts`. After changing the motion tables or the cameras, run `npm run lift:plans` to write it again; a test fails until you do. How the motion is made is in `docs/lift-motion.md`.

## Training blocks

A block (**Blocks**) is a named run of training weeks. Its sessions are ordinary planned sessions, so they turn up on the desk on their days and are logged like any other.

- **Build one from templates**: name it, pick the first day and the number of weeks, and say which template is trained on which day of the week. A week starts on the day you pick, so a block can run Sunday to Saturday. *Add each week* puts that many kilograms on every load, week after week.
- **Paste one from a spreadsheet**: on the import page choose *One training block*. Each stacked group of the sheet becomes a week and each workout in it a session. Dates in the sheet only decide how the sessions are spread over the week.
- **The week view** lays every week out with its days side by side: what is planned, and after training what was done, with the plan struck through where it differs. Add a week (the last one repeated, heavier if you like), add a single session, or take the last week off again.
- The desk shows the block that holds today and a week of its sessions either side of today. Deleting a block removes the sessions that were never started and keeps everything that was trained.

## Logging a session

The session screen is built for one thumb between sets. Each set is one row: what you did last time, the load, the reps, RPE, and a done button. A row you leave untouched logs its target, or last time's numbers when the template gives none. The next set is marked, and for barbell lifts it shows the plates to put on each side. A rest timer starts when a set is done.

Nothing waits on the network. Changes are saved in the background, kept on the phone while offline, and sent when the connection returns. A logged set is never dropped: when a reply is lost on a bad connection, or the same session is open on two devices, what each one holds is combined set by set rather than one replacing the other. Finishing the session publishes its logged sets and notes; sets that were not done stay private. A finished session can be edited or reopened.

The time shown beside a session is measured from its first to its last logged set, and left out when that is under 5 or over 360 minutes, since it then says more about the timer than the session. When sets were logged after the fact, type the time in the Finish sheet instead (`100` minutes or `1:40`, up to 24 hours): it is shown as typed, an empty field means the measured time, and a reopened session keeps it. The field opens the full keyboard, because `1:40` needs a colon that a phone's number pad lacks.

## OAuth setup

Use the exact callback URL registered with each OAuth client. For production, use your HTTPS origin for both `APP_URL` and `NEXTAUTH_URL`.

| Purpose | Client | Callback path |
| --- | --- | --- |
| Owner sign-in | Google OAuth Web application | `/api/auth/callback/google` |
| Fitbit readings | Google OAuth Web application in a project with Google Health API enabled | `/api/connections/google-health/callback` |
| Scale readings | Withings Public API application | `/api/connections/withings/callback` |

- **Owner sign-in** uses Google OpenID Connect through Auth.js. Set `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, and the exact verified Google email in `OWNER_GOOGLE_EMAIL`. For an account whose email Google does not host, also set the Google OpenID Connect subject in `OWNER_GOOGLE_SUB`. Google permits `http://localhost:3000/api/auth/callback/google` for local development.
- **Google Health** uses `GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET`. Enable read-only sleep and health measurements scopes, add your own account as a test user if applicable, and ensure the Fitbit is linked to the Google account you authorize. [Google Health setup](https://developers.google.com/health/setup)
- **Withings** uses `WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET`, with the `user.metrics` permission. Register an HTTPS callback on the deployment origin. API access can depend on your account, region, and subscription. [Withings Public API setup](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/developer-account/create-your-accesses-no-medical-cloud/)
- Generate independent random secrets for `NEXTAUTH_SECRET`, `HEALTH_TOKEN_KEY`, and `HEALTH_SYNC_SECRET` using `openssl rand -base64 32`. Store them in your deployment's secret manager or the ignored `.env.local`.

Open **Connections** on the desk to authorize each provider and run the first sync. Connected providers also refresh automatically in the background when you open the desk, a session, or **Publishing**, and when you finish a workout (with a 15-minute cooldown once today's readings are missing, and no extra calls once today's readings are in place). For rest days, a scheduler can also POST to `/api/connections/sync` with `Authorization: Bearer $HEALTH_SYNC_SECRET`. The first sync covers 30 calendar days and later runs refresh 14 days to pick up late changes.

## Day vitals and publication

- Google sync reads daily resting heart rate and the main sleep duration. Sleep belongs to the local wake date. The composite Fitbit Sleep Score can be entered manually in **Publishing**.
- Withings sync reads the first attributed scale weight from 06:00 up to 10:00 in Stockholm. A day with no readings in that window has no synced morning weight.
- Manually entered public day values take precedence. Synced publishing uses `PUBLISH_GOOGLE_HEALTH` and `PUBLISH_WITHINGS`. Set these after confirming that your providers allow the intended public use. See the [Google Health data policy](https://developers.google.com/health/policies/health-api-developer-user-data-policy) and the [Withings European terms](https://www.withings.com/en-eu/policies/terms-of-service).
- Disconnecting a provider deletes its stored authorization and observations from this app. Provider-side authorization can be revoked through that provider's account settings.

## Database and checks

The schema is in `db/schema.sql`. It runs on every release and is safe to repeat: the first part creates the original tables, the second brings any database to the current shape, and one-time data moves are recorded in `schema_migrations`.

Run `npm test`, `npm run typecheck`, and `npm run build` to verify changes. `npm test` includes the motion model of the lifter (about 20 seconds); `LIFT_MUTATIONS=1 npm test` adds a table of deliberate breakages that each must fail the suite (six minutes), and `LIFT_SWEEP=1` makes the drawing sweeps denser. The database tests are skipped unless `TEST_DATABASE_URL` points at a PostgreSQL database they may create schemas in:

```sh
TEST_DATABASE_URL=postgres://training:training-local@127.0.0.1:55481/training npm test
```

They work inside their own throwaway schemas, load the pre-migration fixture, apply the schema twice and check that nothing was lost.

The design system is described in `DESIGN.md` and lives in `app/globals.css` and `app/ui/`. The site has a light and a dark theme: it follows the device, and the footer has a switch that remembers a choice in a cookie.

`AGENTS.md` is written by `next dev` for coding agents; it is committed so the working tree stays clean.
