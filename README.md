# Training Log

Public workout history and a journal, with an owner-only planner and workout logger. Completed workouts expose actual training sets, exercise metadata, custom fields, and the selected day vitals. Schedules and templates are visible in the owner workspace. Dates use Europe/Stockholm.

## Local development

Requires Node.js 22.13+ and PostgreSQL. Docker Compose starts a local database on port 55481.

```sh
npm ci
cp .env.example .env.local
docker compose up -d db
npm run db:init
npm run dev
```

Open http://localhost:3000. The public site works with an empty database. Open `/admin` after setting up Google sign-in. On a phone, add the HTTPS site to your home screen for direct access to the logger. Edits to existing set rows are saved as drafts in that browser and can be submitted when connectivity returns.

## Plan and log workouts

Build a template by adding exercises and target sets. Reorder exercise blocks, duplicate individual targets, and start a session today or schedule one for another date. You can also save a workout as a template using its recorded reps and loads or any remaining targets. A template and the sessions created from it can be edited independently.

During a session, jump to the next unlogged set or open any set to edit it. The exercise card shows the most recent recorded working set, and you can use prior measurements to fill the form before logging. Completing a session publishes its recorded sets and workout notes.

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

Open **Admin → Health connections** to authorize each provider and run the first sync. A scheduler can POST to `/api/connections/sync` with `Authorization: Bearer $HEALTH_SYNC_SECRET`. The first sync covers 30 calendar days and later runs refresh 14 days to pick up late changes. Configure the scheduler on the chosen host to enable automatic updates.

## Day vitals and publication

- Google sync reads daily resting heart rate and the main sleep duration. Sleep belongs to the local wake date. The composite Fitbit Sleep Score can be entered manually in **Publishing**.
- Withings sync reads the first attributed scale weight from 06:00 up to 10:00 in Stockholm. A day with no readings in that window has no synced morning weight.
- Manually entered public day values take precedence. Synced publishing uses `PUBLISH_GOOGLE_HEALTH` and `PUBLISH_WITHINGS`. Set these after confirming that your providers allow the intended public use. [Google Health data policy](https://developers.google.com/health/policies/health-api-developer-user-data-policy) · [Withings European terms](https://www.withings.com/en-eu/policies/terms-of-service)
- Disconnecting a provider deletes its stored authorization and observations from this app. Provider-side authorization can be revoked through that provider's account settings.

The schema is in `db/schema.sql`. Run `npm test`, `npm run typecheck`, and `npm run build` to verify changes.
