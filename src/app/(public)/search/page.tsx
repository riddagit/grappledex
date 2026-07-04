import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { search, type SearchHit, type SearchResults } from "@/lib/public/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search — Grappledex",
  robots: { index: false, follow: true },
};

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: "athletes", label: "Athletes" },
  { key: "events", label: "Events" },
  { key: "teams", label: "Teams" },
  { key: "promotions", label: "Promotions" },
];

export default async function SearchPage(
  { searchParams }: { searchParams: Promise<{ q?: string }> },
) {
  const { q = "" } = await searchParams;
  const results = q.trim() ? await search(db, q, 20) : null;
  const total = results
    ? GROUPS.reduce((n, g) => n + results[g.key].length, 0)
    : 0;
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow"><span>Search</span></div>
        <h1 className="athlete-name">{q.trim() ? `“${q}”` : "Search"}</h1>
      </header>
      {results === null ? (
        <p className="empty">Type a name to search athletes, events, teams and promotions.</p>
      ) : total === 0 ? (
        <p className="empty">No matches for “{q}”.</p>
      ) : (
        GROUPS.filter((g) => results[g.key].length > 0).map((g) => (
          <ResultGroup key={g.key} label={g.label} hits={results[g.key]} />
        ))
      )}
    </main>
  );
}

function ResultGroup({ label, hits }: { label: string; hits: SearchHit[] }) {
  return (
    <section>
      <div className="section-head">{label}</div>
      <div className="stack">
        {hits.map((h) => (
          <div key={h.id}>
            <Link href={h.path}>{h.title}</Link>
            {h.subtitle ? <span className="empty"> · {h.subtitle}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
