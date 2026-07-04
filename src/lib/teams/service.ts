import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { teams, type Team } from "@/db/schema/team";
import { slugify } from "@/lib/identity/normalize";

export type CreateTeamInput = {
  name: string;
  shortName?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || "team";
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function createTeam(
  db: Db,
  input: CreateTeamInput,
): Promise<Team> {
  const slug = await uniqueSlug(db, input.name);
  const rows = await db
    .insert(teams)
    .values({
      slug,
      name: input.name,
      shortName: input.shortName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
      status: input.status ?? "draft",
    })
    .returning();
  const team = rows[0];
  if (!team) throw new Error("createTeam: insert returned no rows");
  return team;
}

export async function searchTeams(
  db: Db,
  query: string,
): Promise<{ id: string; name: string; slug: string }[]> {
  return db
    .select({ id: teams.id, name: teams.name, slug: teams.slug })
    .from(teams)
    .where(ilike(teams.name, `%${query}%`))
    .limit(10);
}

export async function getTeam(db: Db, id: string): Promise<Team | null> {
  const rows = await db.select().from(teams).where(eq(teams.id, id));
  return rows[0] ?? null;
}
