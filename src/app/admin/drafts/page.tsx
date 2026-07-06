import { db } from "@/db/client";
import { draftDashboard, draftAthleteSummaries, blockedMatches } from "@/lib/curation/queries";
import { PublishActions } from "./publish-actions";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const [dashboard, summaries, blocked] = await Promise.all([
    draftDashboard(db),
    draftAthleteSummaries(db),
    blockedMatches(db),
  ]);

  return (
    <main style={{ maxWidth: 860, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Backfill drafts</h1>
      <p>
        {dashboard.draftAthletes} draft athletes · {dashboard.draftEvents} events ·{" "}
        {dashboard.draftPromotions} promotions · {dashboard.publishableMatches} publishable
        matches ({dashboard.softFlaggedMatches} need a format tag) ·{" "}
        {dashboard.blockedMatches} blocked.
      </p>

      <PublishActions
        publishableMatches={dashboard.publishableMatches}
        summaries={summaries}
      />

      <h2>Blocked (needs a real opponent — left as draft)</h2>
      {blocked.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {blocked.map((b) => (
            <li key={b.matchId}>{b.eventName} — {b.reason}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
