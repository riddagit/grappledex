import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { teams, type Team } from "@/db/schema/team";
import { athleteTeamMemberships } from "@/db/schema/membership";
import { athletes } from "@/db/schema/athlete";

export type RosterMember = {
  athleteId: string; name: string; slug: string;
  role: string | null; startDate: string | null; endDate: string | null;
};
export type TeamPage = { team: Team; current: RosterMember[]; alumni: RosterMember[] };

export async function getTeamPage(db: Db, slug: string): Promise<TeamPage | null> {
  const rows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.slug, slug), eq(teams.status, "published")));
  const team = rows[0];
  if (!team) return null;

  const memberRows = await db
    .select({
      athleteId: athletes.id, name: athletes.fullName, slug: athletes.slug,
      role: athleteTeamMemberships.role,
      startDate: athleteTeamMemberships.startDate,
      endDate: athleteTeamMemberships.endDate,
    })
    .from(athleteTeamMemberships)
    .innerJoin(
      athletes,
      and(
        eq(athleteTeamMemberships.athleteId, athletes.id),
        eq(athletes.status, "published"),
      ),
    )
    .where(eq(athleteTeamMemberships.teamId, team.id));

  const current = memberRows
    .filter((m) => m.endDate === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const alumni = memberRows
    .filter((m) => m.endDate !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { team, current, alumni };
}
