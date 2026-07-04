import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, type Event } from "@/db/schema/event";
import { slugify } from "@/lib/identity/normalize";

export type CreateEventInput = {
  promotionId: string;
  name: string;
  startDate: string;
  endDate?: string;
  venue?: string;
  location?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || "event";
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function createEvent(
  db: Db,
  input: CreateEventInput,
): Promise<Event> {
  const slug = await uniqueSlug(db, input.name);
  const rows = await db
    .insert(events)
    .values({
      slug,
      promotionId: input.promotionId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      venue: input.venue ?? null,
      location: input.location ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
      status: input.status ?? "draft",
    })
    .returning();
  const event = rows[0];
  if (!event) throw new Error("createEvent: insert returned no rows");
  return event;
}

export async function searchEvents(
  db: Db,
  query: string,
): Promise<{ id: string; name: string; slug: string }[]> {
  return db
    .select({ id: events.id, name: events.name, slug: events.slug })
    .from(events)
    .where(ilike(events.name, `%${query}%`))
    .limit(10);
}

export async function getEvent(db: Db, id: string): Promise<Event | null> {
  const rows = await db.select().from(events).where(eq(events.id, id));
  return rows[0] ?? null;
}
