import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { athletes } from "@/db/schema/athlete";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { teams } from "@/db/schema/team";
import { matches } from "@/db/schema/match";

export type PublicUrl = { path: string; lastModified?: Date };

// Every crawlable public path, published-only, with a lastModified where available.
export async function listPublicUrls(db: Db): Promise<PublicUrl[]> {
  const urls: PublicUrl[] = [{ path: "/" }];

  const athleteRows = await db
    .select({ slug: athletes.slug, updatedAt: athletes.updatedAt })
    .from(athletes)
    .where(eq(athletes.status, "published"));
  for (const a of athleteRows) {
    urls.push({ path: `/athlete/${a.slug}`, lastModified: a.updatedAt });
  }

  const eventRows = await db
    .select({ slug: events.slug, updatedAt: events.updatedAt })
    .from(events)
    .where(eq(events.status, "published"));
  for (const e of eventRows) {
    urls.push({ path: `/event/${e.slug}`, lastModified: e.updatedAt });
  }

  const promotionRows = await db
    .select({ slug: promotions.slug, updatedAt: promotions.updatedAt })
    .from(promotions)
    .where(eq(promotions.status, "published"));
  for (const p of promotionRows) {
    urls.push({ path: `/promotion/${p.slug}`, lastModified: p.updatedAt });
  }

  const teamRows = await db
    .select({ slug: teams.slug, updatedAt: teams.updatedAt })
    .from(teams)
    .where(eq(teams.status, "published"));
  for (const t of teamRows) {
    urls.push({ path: `/team/${t.slug}`, lastModified: t.updatedAt });
  }

  // Matches are id-addressed and public only when their event is published too.
  const matchRows = await db
    .select({ id: matches.id, updatedAt: matches.updatedAt })
    .from(matches)
    .innerJoin(
      events,
      and(eq(matches.eventId, events.id), eq(events.status, "published")),
    )
    .where(eq(matches.status, "published"));
  for (const m of matchRows) {
    urls.push({ path: `/match/${m.id}`, lastModified: m.updatedAt });
  }

  return urls;
}
