import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  athleteTeamMemberships, type Membership,
} from "@/db/schema/membership";
import { teams } from "@/db/schema/team";
import { athletes } from "@/db/schema/athlete";

export type AddMembershipInput = {
  athleteId: string;
  teamId: string;
  role?: string;
  startDate: string;
  endDate?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
};

export type MembershipWithTeam = Membership & {
  teamName: string;
  teamSlug: string;
};

export type RosterEntry = {
  membershipId: string;
  athleteId: string;
  fullName: string;
  slug: string;
  role: string | null;
  startDate: string;
  endDate: string | null;
};

export async function addMembership(
  db: Db,
  input: AddMembershipInput,
): Promise<Membership> {
  const rows = await db
    .insert(athleteTeamMemberships)
    .values({
      athleteId: input.athleteId,
      teamId: input.teamId,
      role: input.role ?? null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();
  const membership = rows[0];
  if (!membership) throw new Error("addMembership: insert returned no rows");
  return membership;
}

export async function endMembership(
  db: Db,
  id: string,
  endDate: string,
): Promise<Membership> {
  const rows = await db
    .update(athleteTeamMemberships)
    .set({ endDate, updatedAt: new Date() })
    .where(eq(athleteTeamMemberships.id, id))
    .returning();
  const membership = rows[0];
  if (!membership) throw new Error("endMembership: no membership with that id");
  return membership;
}

// Sort key: current memberships (null endDate) first, then most recent start first.
function byRecencyCurrentFirst(
  a: { startDate: string; endDate: string | null },
  b: { startDate: string; endDate: string | null },
): number {
  if ((a.endDate === null) !== (b.endDate === null)) {
    return a.endDate === null ? -1 : 1;
  }
  return b.startDate.localeCompare(a.startDate);
}

export async function listMembershipsForAthlete(
  db: Db,
  athleteId: string,
): Promise<MembershipWithTeam[]> {
  const rows = await db
    .select({
      membership: athleteTeamMemberships,
      teamName: teams.name,
      teamSlug: teams.slug,
    })
    .from(athleteTeamMemberships)
    .innerJoin(teams, eq(athleteTeamMemberships.teamId, teams.id))
    .where(eq(athleteTeamMemberships.athleteId, athleteId));

  return rows
    .map((r) => ({ ...r.membership, teamName: r.teamName, teamSlug: r.teamSlug }))
    .sort(byRecencyCurrentFirst);
}

export async function teamRoster(
  db: Db,
  teamId: string,
): Promise<{ current: RosterEntry[]; alumni: RosterEntry[] }> {
  const rows = await db
    .select({
      membershipId: athleteTeamMemberships.id,
      athleteId: athletes.id,
      fullName: athletes.fullName,
      slug: athletes.slug,
      role: athleteTeamMemberships.role,
      startDate: athleteTeamMemberships.startDate,
      endDate: athleteTeamMemberships.endDate,
    })
    .from(athleteTeamMemberships)
    .innerJoin(athletes, eq(athleteTeamMemberships.athleteId, athletes.id))
    .where(eq(athleteTeamMemberships.teamId, teamId));

  const sorted = rows.sort(byRecencyCurrentFirst);
  return {
    current: sorted.filter((r) => r.endDate === null),
    alumni: sorted.filter((r) => r.endDate !== null),
  };
}
