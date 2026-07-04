import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { toPrefixTsquery } from "@/lib/public/tsquery";

export type SearchHit = { id: string; path: string; title: string; subtitle: string | null };
export type SearchResults = {
  athletes: SearchHit[]; events: SearchHit[]; teams: SearchHit[]; promotions: SearchHit[];
};

type Row = Record<string, unknown>;
function rows(res: unknown): Row[] {
  return (res as { rows: Row[] }).rows;
}

export async function search(db: Db, rawQuery: string, limit = 5): Promise<SearchResults> {
  const q = toPrefixTsquery(rawQuery);
  if (q === null) return { athletes: [], events: [], teams: [], promotions: [] };
  const tsq = sql`to_tsquery('simple', ${q})`;

  // Athletes: name OR alias match, unioned by athlete id, ranked, published-only.
  const athleteRes = await db.execute(sql`
    SELECT a.id, a.slug, a.full_name AS title, a.nationality AS subtitle,
           max(ts_rank(m.search_vector, ${tsq})) AS rank
    FROM (
      SELECT id AS athlete_id, search_vector FROM athletes WHERE search_vector @@ ${tsq}
      UNION ALL
      SELECT athlete_id, search_vector FROM athlete_aliases WHERE search_vector @@ ${tsq}
    ) m
    JOIN athletes a ON a.id = m.athlete_id AND a.status = 'published'
    GROUP BY a.id, a.slug, a.full_name, a.nationality
    ORDER BY rank DESC, a.full_name
    LIMIT ${limit}`);

  const eventRes = await db.execute(sql`
    SELECT e.id, e.slug, e.name AS title,
           to_char(e.start_date, 'YYYY') AS yr, p.name AS promo
    FROM events e JOIN promotions p ON p.id = e.promotion_id
    WHERE e.search_vector @@ ${tsq} AND e.status = 'published'
    ORDER BY ts_rank(e.search_vector, ${tsq}) DESC, e.start_date DESC
    LIMIT ${limit}`);

  const teamRes = await db.execute(sql`
    SELECT id, slug, name AS title, short_name AS subtitle
    FROM teams WHERE search_vector @@ ${tsq} AND status = 'published'
    ORDER BY ts_rank(search_vector, ${tsq}) DESC, name LIMIT ${limit}`);

  const promoRes = await db.execute(sql`
    SELECT id, slug, name AS title, short_name AS subtitle
    FROM promotions WHERE search_vector @@ ${tsq} AND status = 'published'
    ORDER BY ts_rank(search_vector, ${tsq}) DESC, name LIMIT ${limit}`);

  return {
    athletes: rows(athleteRes).map((r) => ({
      id: String(r.id), path: `/athlete/${r.slug}`,
      title: String(r.title), subtitle: (r.subtitle as string | null) ?? null,
    })),
    events: rows(eventRes).map((r) => ({
      id: String(r.id), path: `/event/${r.slug}`, title: String(r.title),
      subtitle: `${r.yr} · ${r.promo}`,
    })),
    teams: rows(teamRes).map((r) => ({
      id: String(r.id), path: `/team/${r.slug}`,
      title: String(r.title), subtitle: (r.subtitle as string | null) ?? null,
    })),
    promotions: rows(promoRes).map((r) => ({
      id: String(r.id), path: `/promotion/${r.slug}`,
      title: String(r.title), subtitle: (r.subtitle as string | null) ?? null,
    })),
  };
}
