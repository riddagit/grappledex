# RollVault Phase B.3 — Match / Event / Promotion / Team Pages (Design)

**Date:** 2026-07-04
**Status:** Proposed — awaiting user review.
**Depends on:** Phase B.1 (public read layer + seed) and B.2 (design system, athlete page).
**Parent:** `2026-07-04-rollvault-phase-b-public-pages-design.md` §7 (B.3).

---

## 1. Why this increment

B.2 shipped `/athlete/[slug]`, the design system (`globals.css`), and the read-layer
pattern (`src/lib/public/athlete-page.ts`). The athlete hub links out to match, event, and
team pages that do not exist yet — every one of those links currently dead-ends. B.3 builds
the four remaining public entity pages so the linked graph is whole.

**No new source of truth.** Like B.2, every page is a view over Section-4 data. This adds
read functions, routes, and per-page SEO — reusing the existing design system and services.

---

## 2. Page inventory (parent spec §2)

| Route | Page | Core content |
|---|---|---|
| `/match/[id]` | **Match** | competitors (with outcome), event, ruleset, weight, round, method + detail, duration, **embedded YouTube**, athlete links, Sources line |
| `/event/[slug]` | **Event** | promotion, date(s), venue/location, full results (matches, grouped), placements/medals |
| `/promotion/[slug]` | **Promotion** | its published events (date-desc) |
| `/team/[slug]` | **Team** | current roster + alumni (temporal memberships) |

Matches are addressed by **id** (no slug on the `matches` table); the other three by **slug**.

**Publication filter (inherited from B.1/B.2):** public pages render only `published`
entities; `draft` rows 404. Child rows (competitors, videos, placements, memberships)
inherit their parent's state — a match on a draft event does not surface, etc.

---

## 3. Read/query layer

New files in `src/lib/public/`, one per page, mirroring `athlete-page.ts` (pure async
queries against `Db`, published-only, returning a typed page object or `null`). Fully
testable against in-process pglite; no visual dependency.

### 3.1 `getMatchPage(db, id) → MatchPage | null`
- Match row must be `published`; its event must be `published` (else `null` — a match on a
  draft event is not public).
- Returns: match fields (`matchType`, `round`, `weightClass`, `ruleset`, `method`,
  `methodDetail`, `durationSeconds`), event ref (`{ name, slug, startDate }`), competitors
  `[{ id, name, slug, outcome, slotOrder }]` ordered by `slotOrder`, and `videos[]`.
- `verifiedAt` carried for the Sources line.

### 3.2 `getEventPage(db, slug) → EventPage | null`
- Event `published` else `null`.
- Returns: event fields + promotion ref (`{ name, slug }`), and `results` — the event's
  **published** matches, each with its competitors (name/slug/outcome), method label inputs,
  and videos. Also `placements[]` (division, place, athlete ref) over the event.
- **Grouping (view-layer, not query):** the read fn returns a flat `results[]` carrying
  `matchType` + `round`; the page groups them (§4.2). Keeps the query simple and testable.

### 3.3 `getPromotionPage(db, slug) → PromotionPage | null`
- Promotion `published` else `null`.
- Returns: promotion fields + `events[]` (published only, `{ name, slug, startDate,
  venue, location }`, sorted start-date descending).

### 3.4 `getTeamPage(db, slug) → TeamPage | null`
- Team `published` else `null`.
- Returns: team fields + `roster` split into `current` (membership `endDate === null`) and
  `alumni` (past), each `{ athleteId, name, slug, role, startDate, endDate }`, over
  **published** athletes only. Reuses the temporal-membership shape from B.2.

Shared small ref types (`OpponentRef`/`VideoRef` equivalents) may be lifted into a
`src/lib/public/types.ts` if duplication across files becomes noise; otherwise kept local.

---

## 4. Routes (reuse B.2 design system)

All pages are server components under `src/app/`, `dynamic = "force-dynamic"`, using the
existing `globals.css` tokens/classes (`.wrap`, `.section-head`, `.history`, `.res`,
`.method.sub`, `.medal`, `.sources`, `.card-list`, etc.). No new design tokens unless a
genuinely new element appears (see §4.1). `notFound()` on `null`.

### 4.1 `/match/[id]`
The one page dedicated to a single match: the **method is the focal fact**. Layout:
- Header: the two competitors with result emphasis (winner in ink, loser in `--faint`),
  linked to their athlete pages; event name + year linked to `/event/[slug]`.
- Fact line (mono): weight class · ruleset · round · duration (mm:ss).
- **Embedded YouTube** (design decision, parent spec §2): first video rendered as a
  responsive 16:9 iframe (`youtube-nocookie.com/embed/<id>`); additional videos as
  `Watch ↗` links. Requires a small `videoEmbedId(url)` helper + one `.embed` CSS block —
  the only new design element in B.3.
- Sources line (`Sources · last verified {date}`).

### 4.2 `/event/[slug]`
- Header: promotion (linked) · date range · venue, location.
- **Results grouped by type:** superfights first, then bracket matches grouped by round
  (Final → Semifinal → …), each group a `.section-head` + reference-grade table
  (competitors, method, result) reusing the athlete-history table look. Collapses cleanly
  when an event has only one type/round (single group, no empty headers).
- Medals block (placements) reusing the athlete `.medal` styling.
- schema.org **`SportsEvent`** JSON-LD (name, startDate, location).

### 4.3 `/promotion/[slug]`
- Header: promotion name (+ shortName).
- Event list: linked rows (name · year · location), date-desc. Simple `.stack`/table.

### 4.4 `/team/[slug]`
- Header: team name (+ shortName).
- **Current roster** section, then **Alumni** section (each a linked athlete list with role
  + membership span). Empty sections omitted.

---

## 5. SEO (folded into each page)

Per the parent-phase decision to fold per-page SEO into B.3 (leaving only `sitemap.xml` +
`robots.txt` for a thin B.4):
- Each route exports `generateMetadata` → `<title>`, description, and OpenGraph, in the
  established athlete-page voice.
- Event pages emit `SportsEvent` structured data. Match/promotion/team pages get metadata
  only (no misleading structured-data type; matches link to their parent `SportsEvent`).
- `sitemap.xml` / `robots.txt`: **deferred to B.4** (needs the full route set first).

---

## 6. Testing

- One test file per read fn (`match-page.test.ts`, `event-page.test.ts`,
  `promotion-page.test.ts`, `team-page.test.ts`), mirroring `athlete-page.test.ts`:
  seed → assert shape, published-only filtering, draft-parent exclusion, ordering/grouping
  inputs, and `null` on missing/draft.
- **Seed:** the B.1 demo slice is the fixture. Extend `src/db/seed.ts` **only** where a gap
  blocks an assertion (e.g. if no draft match exists to prove exclusion) — minimal, additive.
- Route rendering stays test-level via the read layer (no local Postgres in this
  workspace; parent spec §4 env note). Build must stay green.

---

## 7. Out of scope

`sitemap.xml`/`robots.txt` (B.4), search (Phase C), any new entity or write-path, video
*hosting* (embed of a linked YouTube id only — no upload/re-host), image hosting, rankings.
