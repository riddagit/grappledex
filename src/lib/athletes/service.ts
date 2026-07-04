import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { athletes, athleteAliases, type Athlete } from "@/db/schema/athlete";
import { slugify } from "@/lib/identity/normalize";
import {
  findDuplicateCandidates, type ScoredCandidate,
} from "@/lib/identity/match";

export type CreateAthleteInput = {
  fullName: string;
  nationality?: string;
  imageUrl?: string;
  aliases?: string[];
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, fullName: string): Promise<string> {
  // Names with no Latin content (e.g. CJK, Cyrillic) slugify to "" — fall back
  // to a placeholder so the slug column is never blank.
  const base = slugify(fullName) || "athlete";
  let candidate = base;
  let n = 1;
  // Loop until no row owns the candidate slug.
  while (true) {
    const existing = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(eq(athletes.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function findAthleteDuplicates(
  db: Db,
  name: string,
): Promise<ScoredCandidate[]> {
  const rows = await db
    .select({ id: athletes.id, name: athletes.fullName })
    .from(athletes);
  const aliasRows = await db
    .select({ athleteId: athleteAliases.athleteId, alias: athleteAliases.alias })
    .from(athleteAliases);
  const candidates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: aliasRows.filter((a) => a.athleteId === r.id).map((a) => a.alias),
  }));
  return findDuplicateCandidates(name, candidates);
}

export async function createAthlete(
  db: Db,
  input: CreateAthleteInput,
): Promise<Athlete> {
  const slug = await uniqueSlug(db, input.fullName);
  const rows = await db
    .insert(athletes)
    .values({
      slug,
      fullName: input.fullName,
      nationality: input.nationality ?? null,
      imageUrl: input.imageUrl ?? null,
      status: input.status ?? "draft",
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();

  const athlete = rows[0];
  if (!athlete) throw new Error("createAthlete: insert returned no rows");

  if (input.aliases?.length) {
    await db.insert(athleteAliases).values(
      input.aliases.map((alias) => ({ athleteId: athlete.id, alias })),
    );
  }
  return athlete;
}

export async function getAthlete(db: Db, id: string): Promise<Athlete | null> {
  const rows = await db.select().from(athletes).where(eq(athletes.id, id));
  return rows[0] ?? null;
}

export async function searchAthletes(
  db: Db,
  query: string,
): Promise<{ id: string; fullName: string; slug: string }[]> {
  return db
    .select({ id: athletes.id, fullName: athletes.fullName, slug: athletes.slug })
    .from(athletes)
    .where(ilike(athletes.fullName, `%${query}%`))
    .limit(10);
}
