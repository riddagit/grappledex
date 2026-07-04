# Grappledex Phase C — Public Search (Design)

**Date:** 2026-07-04
**Status:** Proposed.
**Depends on:** Phase B (public read layer + entity pages + SEO).
**Parent:** `2026-07-03-grappledex-v1-design.md` §6 ("Search v1 = Postgres FTS"), §7 (Phase C).

---

## 1. Why

Phase B made every entity a server-rendered page, but the only way to reach one is a direct
link or an external search engine. Phase C adds **on-site search**: a typeahead in a shared
header plus a crawlable results page, over Athletes (+aliases), Events, Teams, and
Promotions. This is the in-product discovery layer the reference-site model
(Basketball-Reference, Transfermarkt, Sherdog) treats as table stakes.

**No new source of truth.** Search is an index/view over Section-4 data. Published-only,
like every public surface.

---

## 2. Decisions (locked)

- **Engine:** Postgres full-text search (per v1 spec). Meilisearch/Typesense remains a later
  drop-in reading the same rows.
- **Surfaces:** instant typeahead (JSON API) **and** a server-rendered `/search?q=` results
  page. The typeahead is the fast path; the results page is crawlable, no-JS-friendly, and
  handles overflow.
- **Placement:** a shared minimal public header (logo → home + search box) on every public
  page, introduced via a route group. Fills the current no-nav gap.

---

## 3. FTS index — generated columns, zero write-path coupling

One migration adds a **generated** `search_vector tsvector` column plus a **GIN** index to
each searchable table. Generated columns are maintained by Postgres automatically, so **no
service/write-path code changes** and nothing to keep in sync:

| Table | `search_vector` source expression (regconfig `simple`) |
|---|---|
| `athletes` | `full_name` |
| `athlete_aliases` | `alias` |
| `events` | `name` |
| `promotions` | `name` + `short_name` |
| `teams` | `name` + `short_name` |

Expression form: `to_tsvector('simple', coalesce(<col>, '') [|| ' ' || coalesce(<col2>,'')])`.
The `simple` config (no stemming/stopwords) suits proper nouns and prefix typeahead.
Verified on pglite: generated `tsvector` column + GIN + `to_tsquery('simple','gord:*')` all
work, and the test DB applies real migrations — so this is fully TDD-able.

Aliases get their own indexed column so an alias hit (e.g. "The King") resolves back to its
`athlete_id`.

**Drizzle:** columns via `.generatedAlwaysAs(sql\`…\`)`, GIN via `index().using("gin", …)`,
migration emitted by `drizzle-kit generate` (hand-verified; the generated SQL is corrected
in-migration if drizzle-kit mis-emits the expression or index method).

---

## 4. Read layer — `src/lib/public/search.ts`

### 4.1 `toPrefixTsquery(raw: string): string | null`
Pure helper. Lowercases, splits on non-alphanumeric, drops empties, appends `:*` to each
token, joins with ` & `. Returns `null` for an all-blank/empty query. Injection-safe by
construction — user input never reaches `to_tsquery` except as `[a-z0-9]+:*` tokens.

### 4.2 `search(db, rawQuery, limit = 5): Promise<SearchResults>`
```ts
export type SearchHit = { id: string; path: string; title: string; subtitle: string | null };
export type SearchResults = {
  athletes: SearchHit[]; events: SearchHit[]; teams: SearchHit[]; promotions: SearchHit[];
};
```
- Empty/`null` tsquery → all-empty results (no DB hit).
- Per group: `WHERE search_vector @@ to_tsquery('simple', $q) AND status = 'published'`,
  ordered by `ts_rank(search_vector, $q) DESC`, then name; `LIMIT limit`.
- **Athletes** additionally match `athlete_aliases.search_vector`; the two id sets are
  unioned and deduped (an athlete matched by both name and alias appears once), then only
  `published` athletes are returned.
- `path` = the entity's public route (`/athlete/{slug}`, `/event/{slug}`,
  `/promotion/{slug}`, `/team/{slug}`). `subtitle`: athlete → nationality (from the athlete
  row — no membership lookup, keeping each group a single query); event →
  `{year} · {promotion}`; team/promotion → short name (or null).

All queries parameterised; pure and pglite-testable.

---

## 5. API — `src/app/api/search/route.ts`

`GET /api/search?q=<raw>` → `SearchResults` JSON. Thin wrapper over `search(db, q)`.
`export const dynamic = "force-dynamic"`. Empty/missing `q` → all-empty groups, 200.
Small `limit` (5/group) tuned for the dropdown.

---

## 6. Results page — `src/app/(public)/search/page.tsx`

Server component reading `searchParams.q`. Calls `search(db, q, 20)` (higher per-group cap).
Renders each non-empty group as a `.section-head` + result list reusing the design system;
empty query shows a prompt, no matches shows an empty state. `generateMetadata` sets
`robots: { index: false, follow: true }` (standard for internal search results — entity
pages, not result pages, are the organic-search surface). `/search` is **not** in the
sitemap.

---

## 7. Shared public header — route group `(public)`

Introduce `src/app/(public)/` and move the existing public pages into it — **URLs are
unchanged** (Next route groups don't affect the path):

```
src/app/(public)/layout.tsx        # renders <SiteHeader/> then {children}
src/app/(public)/page.tsx          # landing (moved from src/app/page.tsx)
src/app/(public)/athlete/[slug]/page.tsx
src/app/(public)/event/[slug]/page.tsx
src/app/(public)/match/[id]/page.tsx
src/app/(public)/promotion/[slug]/page.tsx
src/app/(public)/team/[slug]/page.tsx
src/app/(public)/search/page.tsx   # new (§6)
```

`/admin`, `/api`, `sitemap.ts`, `robots.ts` stay at `src/app/` — untouched. The root
`src/app/layout.tsx` (html/body/globals) is unchanged.

- **`SiteHeader`** (server component): a slim bar — wordmark linking `/`, and `<SearchBox/>`.
- **`SearchBox`** (client component): debounced (~150 ms) fetch to `/api/search?q=`; renders
  a grouped dropdown; arrow-key + Enter navigation (Enter on a hit → its page; Enter with no
  active hit → `/search?q=`); Escape/blur closes. Graceful no-JS fallback: the box is a real
  `<form action="/search">` so submitting works without the dropdown.

---

## 8. Design system additions (`globals.css`)

Scoped additions only: `.site-header` (sticky slim bar, wordmark in mono), `.search-box`
(input + affordance), `.search-dropdown` (grouped, ranked rows with type label + subtitle,
active-row highlight), and result-list styling for the `/search` page. Same tokens
(bone/ink, mono data voice, one accent). No new fonts.

---

## 9. Testing

- **Migration:** auto-applies on pglite via `createTestDb`; every existing suite exercises
  it. A focused test inserts a row and asserts `search_vector` is populated + queryable.
- **`toPrefixTsquery`:** unit tests — tokenizing, casing, `:*` suffixing, empty → null, and
  injection safety (input `a & b | c ():!*` yields only sanitised `token:*` terms).
- **`search()`:** integration against the seed — name prefix ("gord" → Gordon Ryan), alias
  match ("king" → Gordon Ryan via "The King"), event/team/promotion hits, published-only
  (draft entity absent), empty query → all-empty, ranking order, dedupe (athlete matched by
  name and alias appears once), `limit` respected.
- **API route:** returns grouped JSON; empty `q` → empty groups.
- **Build:** `next build` clean; route group compiles and URLs resolve unchanged.

---

## 10. Increment sequencing

- **C.1 — Index + read layer:** migration (generated columns + GIN), `toPrefixTsquery`,
  `search()`. TDD, no UI. *Foundation.*
- **C.2 — API + results page:** `/api/search`, `/search?q=` (route group introduced here,
  public pages moved in).
- **C.3 — Header + typeahead:** `SiteHeader` + `SearchBox` client component + design-system
  additions.

---

## 11. Out of scope

Fuzzy/trigram typo-tolerance (revisit with Meilisearch), searching Matches/Instructionals,
weighting tuning beyond `ts_rank`, search analytics, recent/suggested searches, pagination
of results (the 20/group cap is ample for the v1 corpus).
