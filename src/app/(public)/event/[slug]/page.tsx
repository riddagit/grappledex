import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getEventPage, type EventPage, type EventResult } from "@/lib/public/event-page";

export const dynamic = "force-dynamic";

function year(date: string): string { return date.slice(0, 4); }

function methodLabel(method: string, detail: string | null): string {
  if (method === "SUBMISSION") return detail ?? "Submission";
  if (method === "DECISION") return "Decision";
  if (method === "POINTS") return "Points";
  if (method === "OVERTIME") return "Overtime";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

const ROUND_ORDER = ["Final", "Semifinal", "Quarterfinal", "Round of 16", "Round of 32"];
function roundRank(round: string | null): number {
  const i = ROUND_ORDER.indexOf(round ?? "");
  return i === -1 ? ROUND_ORDER.length : i;
}

// Group results: superfights first, then bracket matches by round (Final → …).
type ResultGroup = { label: string; rows: EventResult[] };
function groupResults(results: EventResult[]): ResultGroup[] {
  const superfights = results.filter((r) => r.matchType !== "BRACKET");
  const bracket = results.filter((r) => r.matchType === "BRACKET");
  const groups: ResultGroup[] = [];
  if (superfights.length) groups.push({ label: "Superfights", rows: superfights });
  const byRound = new Map<string, EventResult[]>();
  for (const r of bracket) {
    const key = r.round ?? "Bracket";
    const list = byRound.get(key) ?? [];
    list.push(r);
    byRound.set(key, list);
  }
  [...byRound.entries()]
    .sort((a, b) => roundRank(a[0]) - roundRank(b[0]))
    .forEach(([label, rows]) => groups.push({ label, rows }));
  return groups;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getEventPage(db, slug);
  if (!page) return { title: "Not found — RollVault" };
  const title = `${page.event.name} — results — RollVault`;
  const description = `${page.event.name} (${page.promotion.name}, ${year(page.event.startDate)}): full results and match videos.`;
  return { title, description, openGraph: { title, description } };
}

export default async function EventPublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getEventPage(db, slug);
  if (!page) notFound();
  const groups = groupResults(page.results);
  return (
    <main className="wrap">
      <SportsEventJsonLd page={page} />
      <header>
        <div className="eyebrow">
          <Link href={`/promotion/${page.promotion.slug}`}>{page.promotion.name}</Link>
          <span>·</span>
          <span>{page.event.startDate}{page.event.endDate ? `–${page.event.endDate}` : ""}</span>
        </div>
        <h1 className="athlete-name">{page.event.name}</h1>
        {(page.event.venue || page.event.location) && (
          <p className="empty">
            {[page.event.venue, page.event.location].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      {groups.length === 0 ? (
        <p className="empty">No results recorded yet.</p>
      ) : (
        groups.map((g) => <ResultTable key={g.label} group={g} />)
      )}

      <Medals page={page} />
    </main>
  );
}

function ResultTable({ group }: { group: ResultGroup }) {
  return (
    <section>
      <div className="section-head">{group.label}</div>
      <div className="table-scroll">
        <table className="history">
          <thead>
            <tr><th>Winner</th><th>Opponent</th><th>Method</th></tr>
          </thead>
          <tbody>
            {group.rows.map((r) => {
              const winner = r.competitors.find((c) => c.outcome === "WON");
              const others = r.competitors.filter((c) => c !== winner);
              return (
                <tr key={r.matchId}>
                  <td className="opp">
                    <Link href={`/match/${r.matchId}`}>{winner ? winner.name : "—"}</Link>
                  </td>
                  <td className="opp">
                    {others.map((o, i) => (
                      <span key={o.id}>
                        {i > 0 ? ", " : ""}
                        <Link href={`/athlete/${o.slug}`}>{o.name}</Link>
                      </span>
                    ))}
                  </td>
                  <td className={`method ${r.method === "SUBMISSION" ? "sub" : ""}`}>
                    {methodLabel(r.method, r.methodDetail)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Medals({ page }: { page: EventPage }) {
  if (page.placements.length === 0) return null;
  const ordinal = ["", "1st", "2nd", "3rd"];
  return (
    <section>
      <div className="section-head">Placements</div>
      <div className="medals">
        {page.placements.map((p, i) => (
          <div className={`medal ${p.place === 1 ? "gold" : ""}`} key={`${p.division}-${p.athlete.slug}-${i}`}>
            <span className="place">{ordinal[p.place] ?? `${p.place}th`}</span>
            <span>
              {p.division} · <Link href={`/athlete/${p.athlete.slug}`}>{p.athlete.name}</Link>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SportsEventJsonLd({ page }: { page: EventPage }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: page.event.name,
    startDate: page.event.startDate,
    endDate: page.event.endDate ?? undefined,
    location: page.event.location
      ? { "@type": "Place", name: page.event.venue ?? page.event.location, address: page.event.location }
      : undefined,
    organizer: { "@type": "Organization", name: page.promotion.name },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
