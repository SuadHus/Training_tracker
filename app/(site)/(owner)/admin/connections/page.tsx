import { healthTimeZone } from "@/src/lib/health-normalize";
import { healthProviders } from "@/src/lib/health-providers";
import { healthStatuses } from "@/src/lib/health-sync";
import { requireOwner } from "@/src/lib/owner";
import { Icon } from "@/app/ui/icons";
import { SubmitButton } from "@/app/ui/submit-button";
import { GoogleSignOut } from "@/app/(site)/login/sign-in";
import styles from "../../owner.module.css";
import { connectSource, disconnectSource, syncSource } from "./actions";

const messages: Record<string, string> = {
  connected: "Account connected. Sync now to check for recent readings.",
  "connect-failed": "Could not connect the account. Confirm the callback and read permissions, then try again.",
  disconnected: "Account disconnected and imported readings removed.",
  "disconnect-failed": "Could not disconnect the account. Try again.",
  busy: "Another sync or account change took priority. Check the last sync time before trying again.",
  failed: "Could not sync the provider. Try again or reconnect the account if access expired.",
  inactive: "Connect the account and configure its credentials before syncing.",
};

export const dynamic = "force-dynamic";
export const metadata = { title: "Health connections", robots: { index: false, follow: false } };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: healthTimeZone,
});

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ result?: string | string[]; count?: string | string[] }> }) {
  await requireOwner();
  const query = await searchParams;
  const statuses = await healthStatuses();
  const queryResult = typeof query.result === "string" ? query.result : undefined;
  const syncedCount = typeof query.count === "string" && /^\d+$/.test(query.count) ? Number(query.count) : null;
  const result = queryResult === "synced"
    ? (syncedCount === null ? "Sync complete." : `Sync complete. ${syncedCount} readings in the refreshed period.`)
    : (queryResult && Object.hasOwn(messages, queryResult) ? messages[queryResult] : null);
  const error = queryResult?.endsWith("failed");

  return (
    <>
      <div className="row opener row--stack">
        <h1 className={styles.full}>Health connections</h1>
      </div>
      {result && (
        <div className="row row--flush row--stack">
          <div />
          <p className={error ? "notice notice--alert" : "notice"} role={error ? "alert" : "status"}>{result}</p>
        </div>
      )}
      {statuses.map(({ provider, configured, connected, reauthorize, lastSyncedAt }) => (
        <div className="row row--section row--stack" key={provider}>
          <h2 className="row-margin">{healthProviders[provider].label}</h2>
          <div className={styles.connect}>
            <p>{provider === "google-health"
              ? "Syncs daily resting heart rate and the main sleep duration. Fitbit’s composite sleep score is entered manually."
              : "Syncs the first attributed weigh-in from 06:00 to before 10:00 in Stockholm time."}</p>
            <p className="soft">{!configured ? "Server credentials or callback are missing." : !connected ? "Ready to connect." : reauthorize
              ? "Reconnect to restore access."
              : lastSyncedAt ? `Last synced ${dateTime.format(new Date(lastSyncedAt))} (Stockholm).` : "Connected. First sync pending."}</p>
            {configured && (
              <form>
                <input type="hidden" name="provider" value={provider} />
                <SubmitButton formAction={connectSource} className={connected ? "btn btn--plain" : "btn"}>{connected ? "Reconnect" : "Connect"} {provider === "withings" ? "Withings" : "Google Health"}</SubmitButton>
                {connected && !reauthorize && <SubmitButton formAction={syncSource} pending="Syncing">{provider === "withings" ? "Force sync" : "Sync now"}</SubmitButton>}
              </form>
            )}
            {connected && (
              <details className={styles.disconnect}>
                <summary>Disconnect<Icon name="down" small /></summary>
                <form action={disconnectSource}>
                  <input type="hidden" name="provider" value={provider} />
                  <p>This removes imported readings from this site. You can revoke access in your provider account.</p>
                  <SubmitButton className="btn btn--danger" pending="Disconnecting">Disconnect and remove readings</SubmitButton>
                </form>
              </details>
            )}
          </div>
        </div>
      ))}
      <div className="row row--section row--stack">
        <h2 className="row-margin">Account</h2>
        <div><GoogleSignOut className="btn btn--plain" /></div>
      </div>
    </>
  );
}
