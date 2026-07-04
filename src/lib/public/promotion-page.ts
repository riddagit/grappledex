import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { promotions, type Promotion } from "@/db/schema/promotion";
import { events } from "@/db/schema/event";

export type PromotionEventRef = {
  name: string; slug: string; startDate: string;
  venue: string | null; location: string | null;
};
export type PromotionPage = { promotion: Promotion; events: PromotionEventRef[] };

export async function getPromotionPage(
  db: Db,
  slug: string,
): Promise<PromotionPage | null> {
  const rows = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.slug, slug), eq(promotions.status, "published")));
  const promotion = rows[0];
  if (!promotion) return null;

  const eventRows = await db
    .select({
      name: events.name, slug: events.slug, startDate: events.startDate,
      venue: events.venue, location: events.location,
    })
    .from(events)
    .where(and(eq(events.promotionId, promotion.id), eq(events.status, "published")))
    .orderBy(desc(events.startDate));

  return { promotion, events: eventRows };
}
