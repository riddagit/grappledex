import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getTeam } from "@/lib/teams/service";
import { teamRoster, type RosterEntry } from "@/lib/memberships/service";
import { MembershipForm } from "./membership-form";

function RosterList({ entries }: { entries: RosterEntry[] }) {
  return (
    <ul>
      {entries.map((r) => (
        <li key={r.membershipId}>
          {r.fullName}
          {r.role ? ` · ${r.role}` : ""}
          {" · "}{r.startDate}–{r.endDate ?? "present"}
        </li>
      ))}
    </ul>
  );
}

export default async function TeamHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const team = await getTeam(db, id);
  if (!team) notFound();
  const roster = await teamRoster(db, id);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{team.name}{team.shortName ? ` (${team.shortName})` : ""}</h1>

      <section>
        <h2>Current roster ({roster.current.length})</h2>
        {roster.current.length ? <RosterList entries={roster.current} /> : <p>No current members.</p>}
      </section>

      <section>
        <h2>Alumni ({roster.alumni.length})</h2>
        {roster.alumni.length ? <RosterList entries={roster.alumni} /> : <p>No alumni.</p>}
      </section>

      <section>
        <MembershipForm teamId={id} />
      </section>
    </main>
  );
}
