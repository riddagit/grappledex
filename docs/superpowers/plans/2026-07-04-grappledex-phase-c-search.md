# Phase C — Public Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On-site search over published Athletes (+aliases), Events, Teams, Promotions — a Postgres-FTS read layer, a JSON API, a crawlable results page, and a shared-header typeahead.

**Architecture:** Generated `tsvector` columns + GIN indexes (one migration, zero write-path coupling) power a pure `search()` read function. A thin `/api/search` route serves the typeahead; a server-rendered `/search` page serves crawlable results. A new `(public)` route group adds a shared header with a client-side `SearchBox`; existing public pages move into the group with unchanged URLs.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (raw `sql` FTS fragments), Postgres/pglite, Vitest, React 19.

## Global Constraints

- Published-only on every public surface; `simple` text-search config (proper nouns, prefix typeahead).
- No write-path/service changes — generated columns are Postgres-maintained.
- User input reaches `to_tsquery` only as sanitised `[a-z0-9]+:*` tokens (injection-safe).
- Route groups do not change URLs. `/admin`, `/api`, `sitemap.ts`, `robots.ts`, root `layout.tsx` stay put.
- `/search` is `robots: noindex, follow` and stays out of the sitemap.
- Reuse `globals.css` tokens; scoped additions only. Tests: `npm run test`. Build: `npm run build`.

---

## File Structure

- `src/db/schema/{athlete,event,promotion,team}.ts` — add `searchVector` (customType `tsvector`) generated columns + GIN indexes.
- `drizzle/0010_*.sql` + `drizzle/meta/_journal.json` — the migration (authoritative DDL).
- `src/lib/public/tsquery.ts` (+ test) — `toPrefixTsquery`.
- `src/lib/public/search.ts` (+ test) — `search()`.
- `src/app/api/search/route.ts` — JSON API.
- `src/app/(public)/layout.tsx` — shared header wrapper.
- `src/app/(public)/search/page.tsx` — results page.
- `src/components/site-header.tsx`, `src/components/search-box.tsx` — header + typeahead.
- Move: existing public pages into `src/app/(public)/`.
- `src/app/globals.css` — header/typeahead/result styles.

---

### Task 1: FTS migration + schema columns (C.1)

**Files:**
- Create: `src/db/schema/tsvector.ts`
- Modify: `src/db/schema/athlete.ts`, `event.ts`, `promotion.ts`, `team.ts`
- Create: `drizzle/0010_add_search_vectors.sql`
- Modify: `drizzle/meta/_journal.json`
- Test: `src/db/schema/search-vector.test.ts`

**Interfaces:**
- Produces: a `tsvector` customType; `searchVector` column on `athletes`, `athleteAliases`, `events`, `promotions`, `teams`; GIN indexes `<table>_search_idx`.

- [ ] **Step 1: Add the customType**

Create `src/db/schema/tsvector.ts`:

```ts
import { customType } from "drizzle-orm/pg-core";

// Postgres tsvector. We never write to it (generated column); it exists so the
// ORM/schema is aware of the column and drizzle-kit won't try to drop it.
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
```

- [ ] **Step 2: Add generated columns + GIN indexes to the four schemas**

In `src/db/schema/athlete.ts`, import `sql` and `tsvector`, add to `athletes` columns:

```ts
  searchVector: tsvector("search_vector").generatedAlwaysAs(
    (): SQL => sql`to_tsvector('simple', coalesce(${athletes.fullName}, ''))`,
  ),
```
and to the `athletes` table config a GIN index. Because `athletes` currently has no
config callback, add one:
```ts
}, (t) => [index("athletes_search_idx").using("gin", t.searchVector)]);
```
For `athleteAliases`, add `searchVector` generated from `alias` and index
`athlete_aliases_search_idx`. Imports needed at top: `import { sql, type SQL } from "drizzle-orm";`
and `import { tsvector } from "./tsvector";` (and `index` is already imported).

In `event.ts` (`events` ← `name`), `promotion.ts` (`promotions` ← `name` + `short_name`),
`team.ts` (`teams` ← `name` + `short_name`) add the analogous column + index. The
two-column expression:
```ts
  searchVector: tsvector("search_vector").generatedAlwaysAs(
    (): SQL => sql`to_tsvector('simple', coalesce(${promotions.name}, '') || ' ' || coalesce(${promotions.shortName}, ''))`,
  ),
```

- [ ] **Step 3: Hand-author the migration SQL (authoritative DDL)**

Create `drizzle/0010_add_search_vectors.sql`:

```sql
ALTER TABLE "athletes" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("full_name", ''))) STORED;--> statement-breakpoint
CREATE INDEX "athletes_search_idx" ON "athletes" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "athlete_aliases" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("alias", ''))) STORED;--> statement-breakpoint
CREATE INDEX "athlete_aliases_search_idx" ON "athlete_aliases" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", ''))) STORED;--> statement-breakpoint
CREATE INDEX "events_search_idx" ON "events" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("short_name", ''))) STORED;--> statement-breakpoint
CREATE INDEX "promotions_search_idx" ON "promotions" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("short_name", ''))) STORED;--> statement-breakpoint
CREATE INDEX "teams_search_idx" ON "teams" USING gin ("search_vector");
```

- [ ] **Step 4: Register the migration in the journal**

Append to the `entries` array in `drizzle/meta/_journal.json` (use the next `idx`, current
epoch-ms for `when`, matching the existing entry shape):

```json
    {
      "idx": 10,
      "version": "7",
      "when": 1783200000000,
      "tag": "0010_add_search_vectors",
      "breakpoints": true
    }
```

(If the last existing `idx` is not 9, use last+1 and keep the array ordered.)

- [ ] **Step 5: Write the failing test**

Create `src/db/schema/search-vector.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("search_vector generated columns", () => {
  it("populate and match via to_tsquery on pglite", async () => {
    await seed(ctx.db);
    const res = await ctx.db.execute(
      sql`SELECT full_name FROM athletes
          WHERE search_vector @@ to_tsquery('simple', 'gord:*')`,
    );
    const rows = (res as unknown as { rows: { full_name: string }[] }).rows;
    expect(rows.map((r) => r.full_name)).toContain("Gordon Ryan");
  });
});
```

- [ ] **Step 6: Run — expect fail, then pass after migration applies**

Run: `npm run test -- search-vector`
Expected: initially FAIL if the migration/journal is not yet wired; PASS once Steps 3–4 are
in place (migrations apply on pglite via `createTestDb`).

- [ ] **Step 7: Verify schema/migration agreement**

Run: `npx drizzle-kit generate`
Expected: **no new migration** is emitted (schema matches the hand-authored DDL). If a diff
is emitted, reconcile the schema column/index definitions until `generate` is a no-op, then
delete any stray generated file. Re-run `npm run test` — all green.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema drizzle/0010_add_search_vectors.sql drizzle/meta/_journal.json
git commit -m "feat: add FTS search_vector columns + GIN indexes"
```

---

### Task 2: `toPrefixTsquery` (C.1)

**Files:**
- Create: `src/lib/public/tsquery.ts`
- Test: `src/lib/public/tsquery.test.ts`

**Interfaces:**
- Produces: `export function toPrefixTsquery(raw: string): string | null;`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toPrefixTsquery } from "@/lib/public/tsquery";

describe("toPrefixTsquery", () => {
  it("lowercases, splits, and prefixes each token", () => {
    expect(toPrefixTsquery("Gordon Ryan")).toBe("gordon:* & ryan:*");
    expect(toPrefixTsquery("gord")).toBe("gord:*");
  });
  it("returns null for empty / whitespace / punctuation-only input", () => {
    expect(toPrefixTsquery("")).toBeNull();
    expect(toPrefixTsquery("   ")).toBeNull();
    expect(toPrefixTsquery("&|!()")).toBeNull();
  });
  it("is injection-safe: only sanitised token:* terms survive", () => {
    expect(toPrefixTsquery("a & b | c ():!*")).toBe("a:* & b:* & c:*");
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run test -- tsquery`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// Turn raw user text into a safe prefix tsquery: lowercase, split on anything
// that is not a latin letter or digit, drop empties, append :* to each token,
// AND them together. User input never reaches to_tsquery except as [a-z0-9]+:*.
export function toPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test -- tsquery`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/tsquery.ts src/lib/public/tsquery.test.ts
git commit -m "feat: add injection-safe prefix tsquery builder"
```

---

### Task 3: `search()` read layer (C.1)

**Files:**
- Create: `src/lib/public/search.ts`
- Test: `src/lib/public/search.test.ts`

**Interfaces:**
- Consumes: `toPrefixTsquery`; the seed (`gordon-ryan`, alias "The King", ADCC promotion/event, New Wave team).
- Produces:
  ```ts
  export type SearchHit = { id: string; path: string; title: string; subtitle: string | null };
  export type SearchResults = {
    athletes: SearchHit[]; events: SearchHit[]; teams: SearchHit[]; promotions: SearchHit[];
  };
  export function search(db: Db, rawQuery: string, limit?: number): Promise<SearchResults>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createAthlete } from "@/lib/athletes/service";
import { search } from "@/lib/public/search";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("search", () => {
  it("matches athletes by name prefix", async () => {
    await seed(ctx.db);
    const r = await search(ctx.db, "gord");
    expect(r.athletes.map((h) => h.title)).toContain("Gordon Ryan");
    expect(r.athletes[0]?.path).toBe("/athlete/gordon-ryan");
  });

  it("matches an athlete by alias and de-dupes", async () => {
    await seed(ctx.db); // Gordon has alias "The King"
    const r = await search(ctx.db, "king");
    const gordon = r.athletes.filter((h) => h.title === "Gordon Ryan");
    expect(gordon).toHaveLength(1);
  });

  it("matches events, teams and promotions", async () => {
    await seed(ctx.db);
    expect((await search(ctx.db, "adcc")).promotions.map((h) => h.title)).toContain("ADCC");
    expect((await search(ctx.db, "adcc")).events.length).toBeGreaterThan(0);
    expect((await search(ctx.db, "new wave")).teams.map((h) => h.title)).toContain("New Wave Jiu-Jitsu");
  });

  it("excludes draft entities", async () => {
    await seed(ctx.db);
    await createAthlete(ctx.db, { fullName: "Zzdraft Person" });
    const r = await search(ctx.db, "zzdraft");
    expect(r.athletes).toHaveLength(0);
  });

  it("returns all-empty groups for a blank query without hitting search", async () => {
    await seed(ctx.db);
    const r = await search(ctx.db, "   ");
    expect(r).toEqual({ athletes: [], events: [], teams: [], promotions: [] });
  });

  it("respects the per-group limit", async () => {
    await seed(ctx.db);
    const r = await search(ctx.db, "a", 1); // 'a:*' matches several athletes
    expect(r.athletes.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run test -- public/search`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { toPrefixTsquery } from "@/lib/public/tsquery";

export type SearchHit = { id: string; path: string; title: string; subtitle: string | null };
export type SearchResults = {
  athletes: SearchHit[]; events: SearchHit[]; teams: SearchHit[]; promotions: SearchHit[];
};

const EMPTY: SearchResults = { athletes: [], events: [], teams: [], promotions: [] };

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
```

Note the `EMPTY` const is referenced by the early return via a fresh object literal to avoid
shared-reference mutation; if unused remove it. Confirm `db.execute` on pglite returns
`{ rows }` (the schema test in Task 1 already relied on this shape).

- [ ] **Step 4: Run — expect pass**

Run: `npm run test -- public/search`
Expected: PASS (6 tests). If a `.rows` access fails, adjust `rows()` to the actual
pglite/drizzle result shape observed in Task 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/search.ts src/lib/public/search.test.ts
git commit -m "feat: add public FTS search read layer"
```

---

### Task 4: `/api/search` route (C.2)

**Files:**
- Create: `src/app/api/search/route.ts`
- Test: `src/app/api/search/route.test.ts`

**Interfaces:**
- Consumes: `search`, `SearchResults`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  ctx = await createTestDb();
  vi.doMock("@/db/client", () => ({ db: ctx.db }));
});
afterEach(async () => { vi.doUnmock("@/db/client"); await ctx.close(); });

describe("GET /api/search", () => {
  it("returns grouped results for a query", async () => {
    await seed(ctx.db);
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(new Request("http://x/api/search?q=gord"));
    const body = await res.json();
    expect(body.athletes.map((h: { title: string }) => h.title)).toContain("Gordon Ryan");
  });

  it("returns empty groups when q is missing", async () => {
    await seed(ctx.db);
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(new Request("http://x/api/search"));
    const body = await res.json();
    expect(body).toEqual({ athletes: [], events: [], teams: [], promotions: [] });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run test -- api/search`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { search } from "@/lib/public/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await search(db, q);
  return NextResponse.json(results);
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test -- api/search`
Expected: PASS (2 tests). If `vi.doMock` timing fails, mirror whatever mocking the existing
`src/app/api/admin/*` route tests use; if none exist, assert against `search()` directly and
keep the route a trivial wrapper.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/search/route.ts src/app/api/search/route.test.ts
git commit -m "feat: add /api/search JSON endpoint"
```

---

### Task 5: Introduce `(public)` route group + move pages (C.2)

Moving files with `git mv` preserves history; URLs are unchanged. Do the move and the shared
layout together so the app compiles at the commit boundary.

**Files:**
- Create: `src/app/(public)/layout.tsx`
- Move: `src/app/page.tsx` → `src/app/(public)/page.tsx`; `src/app/athlete/`, `event/`,
  `match/`, `promotion/`, `team/` → under `src/app/(public)/`.

**Interfaces:**
- Consumes (Task 8): `SiteHeader`.

- [ ] **Step 1: Move the public routes into the group**

```bash
mkdir -p "src/app/(public)"
git mv src/app/page.tsx "src/app/(public)/page.tsx"
git mv src/app/athlete "src/app/(public)/athlete"
git mv src/app/event "src/app/(public)/event"
git mv src/app/match "src/app/(public)/match"
git mv src/app/promotion "src/app/(public)/promotion"
git mv src/app/team "src/app/(public)/team"
```

- [ ] **Step 2: Add the group layout (header wired in Task 8; placeholder import now)**

Create `src/app/(public)/layout.tsx`:

```tsx
import { SiteHeader } from "@/components/site-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
```

- [ ] **Step 3: Create a minimal SiteHeader so the app compiles (fleshed out in Task 8)**

Create `src/components/site-header.tsx`:

```tsx
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="wordmark">Grappledex</Link>
    </header>
  );
}
```

- [ ] **Step 4: Build — verify URLs unchanged**

Run: `npm run build`
Expected: clean. Route list still shows `/`, `/athlete/[slug]`, `/event/[slug]`,
`/match/[id]`, `/promotion/[slug]`, `/team/[slug]` (route group adds no path segment).

- [ ] **Step 5: Run tests + commit**

Run: `npm run test` → all green.

```bash
git add -A
git commit -m "refactor: move public pages into (public) route group with shared header"
```

---

### Task 6: `/search` results page (C.2)

**Files:**
- Create: `src/app/(public)/search/page.tsx`

**Interfaces:**
- Consumes: `search`, `SearchResults`, `SearchHit`.

- [ ] **Step 1: Implement**

```tsx
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
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` → clean; `/search` appears as a dynamic route.

```bash
git add "src/app/(public)/search/page.tsx"
git commit -m "feat: add /search results page (noindex, follow)"
```

---

### Task 7: `SearchBox` typeahead (C.3)

**Files:**
- Create: `src/components/search-box.tsx`
- Test: `src/components/search-box.test.tsx`

**Interfaces:**
- Consumes: `/api/search` (JSON `SearchResults`).
- Produces: `<SearchBox />`.

- [ ] **Step 1: Implement the client component**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResults, SearchHit } from "@/lib/public/search";

const ORDER: (keyof SearchResults)[] = ["athletes", "events", "teams", "promotions"];
const LABEL: Record<keyof SearchResults, string> = {
  athletes: "Athlete", events: "Event", teams: "Team", promotions: "Promotion",
};

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data: SearchResults) => { setResults(data); setOpen(true); })
        .catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const flat: SearchHit[] = results ? ORDER.flatMap((k) => results[k]) : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  }

  return (
    <form ref={boxRef} className="search-box" role="search" action="/search" onSubmit={submit}>
      <input
        name="q" value={q} onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Search athletes, events, teams…" autoComplete="off" aria-label="Search"
      />
      {open && flat.length > 0 && (
        <div className="search-dropdown" role="listbox">
          {ORDER.filter((k) => results![k].length > 0).map((k) => (
            <div key={k} className="sd-group">
              <div className="sd-label">{LABEL[k]}</div>
              {results![k].map((h) => (
                <button
                  type="button" key={h.id} className="sd-row" role="option"
                  onClick={() => { router.push(h.path); setOpen(false); }}
                >
                  <span className="sd-title">{h.title}</span>
                  {h.subtitle ? <span className="sd-sub">{h.subtitle}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Test (render + fetch mock)**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchBox } from "@/components/search-box";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => { vi.restoreAllMocks(); });

describe("SearchBox", () => {
  it("shows dropdown hits from /api/search after typing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        athletes: [{ id: "1", path: "/athlete/gordon-ryan", title: "Gordon Ryan", subtitle: "USA" }],
        events: [], teams: [], promotions: [],
      }),
    })) as unknown as typeof fetch);
    render(<SearchBox />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "gord" } });
    await waitFor(() => expect(screen.getByText("Gordon Ryan")).toBeInTheDocument());
  });
});
```

Precondition: confirm `@testing-library/react` + `jsdom` are available. Run
`npm ls @testing-library/react jsdom vitest-dom @testing-library/jest-dom`. If missing,
this component test is **optional** — skip it (delete the file) rather than adding new deps
in this plan; the API and read-layer tests already cover behaviour. Note the decision in the
commit message.

- [ ] **Step 3: Run test (if kept) + commit**

Run: `npm run test -- search-box` (if kept) → PASS.

```bash
git add src/components/search-box.tsx src/components/search-box.test.tsx
git commit -m "feat: add SearchBox typeahead client component"
```

---

### Task 8: Wire header + design-system styles (C.3)

**Files:**
- Modify: `src/components/site-header.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Put the SearchBox in the header**

Replace `src/components/site-header.tsx` body:

```tsx
import Link from "next/link";
import { SearchBox } from "@/components/search-box";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="wordmark">Grappledex</Link>
        <SearchBox />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add scoped styles to `globals.css`**

Append:

```css
/* ---- shared public header + search ---- */
.site-header {
  position: sticky; top: 0; z-index: 20;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.site-header-inner {
  max-width: var(--wrap); margin: 0 auto;
  padding: 0.7rem clamp(1.15rem, 4vw, 2.5rem);
  display: flex; align-items: center; gap: 1.5rem;
}
.wordmark {
  font-family: var(--font-data); font-weight: 600; letter-spacing: 0.02em;
  text-decoration: none; color: var(--ink); white-space: nowrap;
}
.search-box { position: relative; flex: 1; max-width: 28rem; margin-left: auto; }
.search-box input {
  width: 100%; font-family: var(--font-data); font-size: 0.85rem;
  padding: 0.5rem 0.7rem; color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-strong);
}
.search-box input:focus { outline: none; border-color: var(--accent); }
.search-dropdown {
  position: absolute; top: calc(100% + 0.35rem); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--line-strong);
  max-height: 70vh; overflow-y: auto; padding: 0.3rem;
}
.sd-group { padding: 0.2rem 0; }
.sd-label {
  font-family: var(--font-data); font-size: 0.62rem; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); padding: 0.3rem 0.5rem 0.15rem;
}
.sd-row {
  display: flex; flex-direction: column; gap: 0.1rem; width: 100%;
  text-align: left; background: none; border: 0; cursor: pointer;
  padding: 0.4rem 0.5rem; color: var(--ink);
}
.sd-row:hover, .sd-row:focus { background: color-mix(in srgb, var(--ink) 6%, transparent); outline: none; }
.sd-title { font-family: var(--font-name); font-size: 0.9rem; }
.sd-sub { font-family: var(--font-data); font-size: 0.7rem; color: var(--muted); }

@media (max-width: 34rem) {
  .site-header-inner { gap: 0.8rem; }
  .wordmark { font-size: 0.85rem; }
}
```

- [ ] **Step 3: Build + full test**

Run: `npm run build` → clean.
Run: `npm run test` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/site-header.tsx src/app/globals.css
git commit -m "feat: wire SearchBox into shared header + styles"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full suite + build**

Run: `npm run test` → all green (prior + tsquery + search + api + optional component).
Run: `npm run build` → clean; routes include `/search` and unchanged public URLs.

- [ ] **Step 2: Confirm sitemap/robots unaffected**

Confirm `/search` is absent from `listPublicUrls` output shape (it enumerates entities only)
and that `robots.ts` still disallows `/admin/`, `/api/`.

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A && git commit -m "chore: Phase C verification" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:** §3 index → Task 1. §4.1 `toPrefixTsquery` → Task 2. §4.2 `search()` →
Task 3. §5 API → Task 4. §6 results page → Task 6. §7 route group + header → Tasks 5, 8. §7
`SearchBox` → Task 7. §8 styles → Task 8. §9 testing → Tasks 1–9. ✓

**Placeholder scan:** No TBD/TODO. Two contingencies are explicit with fallbacks (drizzle-kit
reconciliation in Task 1 Step 7; optional component test in Task 7 Step 2 gated on existing
deps) — decisions, not open placeholders.

**Type consistency:** `SearchHit`/`SearchResults` defined in Task 3, consumed unchanged in
Tasks 4, 6, 7. `toPrefixTsquery` signature identical in Tasks 2 and 3. `SiteHeader` created
as a stub in Task 5 and fleshed out in Task 8 — same export name. Route-group move (Task 5)
leaves URLs unchanged, so `path` values built in Task 3 stay valid. ✓
