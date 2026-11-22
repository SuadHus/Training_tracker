import Link from "next/link";

import { healthTimeZone } from "@/src/lib/health-normalize";
import { healthProviders } from "@/src/lib/health-providers";
import { healthStatuses } from "@/src/lib/health-sync";
import { requireOwner } from "@/src/lib/owner";

import styles from "../admin.module.css";
import { connectSource, disconnectSource, syncSource } from "./actions";

const messages: Record<string, string> = {
  connected: "Account connected. Sync now to check for recent readings.",
  "connect-failed": "Couldn’t connect the account. Confirm the callback and read permissions, then try again.",
  disconnected: "Account disconnected and imported readings removed.",
  "disconnect-failed": "Couldn’t disconnect the account. Try again.",
  busy: "Another sync or account change took priority. Check the last sync time before trying again.",
  failed: "Couldn’t sync the provider. Try again or reconnect the account if access expired.",
  inactive: "Connect the account and configure its credentials before syncing.",
};

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
      <header className="intro">
        <Link href="/admin" className="back-link">← Training desk</Link>
        <h1>Health connections</h1>
      </header>
      {result && <p className={error ? styles.error : undefined} role={error ? "alert" : "status"}>{result}</p>}
      <div className={styles.connectionGrid}>
        {statuses.map(({ provider, configured, connected, reauthorize, lastSyncedAt }) => (
          <section className={styles.panel} key={provider}>
            <div className={styles.panelHeading}><h2>{healthProviders[provider].label}</h2></div>
            <p>{provider === "google-health"
              ? "Syncs daily resting heart rate and the main sleep duration. Fitbit’s composite sleep score is entered manually."
              : "Syncs the first attributed weigh-in from 06:00 to before 10:00 in Stockholm time."}</p>
            <p>{!configured ? "Server credentials or callback are missing." : !connected ? "Ready to connect." : reauthorize
              ? "Reconnect to restore access."
              : lastSyncedAt ? `Last synced ${dateTime.format(new Date(lastSyncedAt))} (Stockholm).` : "Connected. First sync pending."}</p>
            <form className={styles.actions}>
              <input type="hidden" name="provider" value={provider} />
              {configured && <button type="submit" formAction={connectSource}>{connected ? "Reconnect" : "Connect"} {provider === "withings" ? "Withings" : "Google Health"}</button>}
              {configured && connected && !reauthorize && <button type="submit" formAction={syncSource}>{provider === "withings" ? "Force sync" : "Sync now"}</button>}
            </form>
            {connected && (
              <details className={styles.toggle}>
                <summary>Disconnect</summary>
                <form className={styles.actions} action={disconnectSource}>
                  <input type="hidden" name="provider" value={provider} />
                  <p>This removes imported readings from this site. You can revoke access in your provider account.</p>
                  <button type="submit" className={styles.secondaryButton}>Disconnect and remove readings</button>
                </form>
              </details>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
