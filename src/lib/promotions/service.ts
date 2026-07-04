import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { promotions, type Promotion } from "@/db/schema/promotion";
import { slugify } from "@/lib/identity/normalize";

export type CreatePromotionInput = {
  name: string;
  shortName?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || "promotion";
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await db
      .select({ id: promotions.id })
      .from(promotions)
      .where(eq(promotions.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function createPromotion(
  db: Db,
  input: CreatePromotionInput,
): Promise<Promotion> {
  const slug = await uniqueSlug(db, input.name);
  const rows = await db
    .insert(promotions)
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
  const promotion = rows[0];
  if (!promotion) throw new Error("createPromotion: insert returned no rows");
  return promotion;
}

export async function searchPromotions(
  db: Db,
  query: string,
): Promise<{ id: string; name: string; slug: string }[]> {
  return db
    .select({ id: promotions.id, name: promotions.name, slug: promotions.slug })
    .from(promotions)
    .where(ilike(promotions.name, `%${query}%`))
    .limit(10);
}
