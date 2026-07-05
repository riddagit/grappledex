# RollVault — v1 Design Spec

**Date:** 2026-07-03
**Status:** Approved (brainstorming complete) → ready for implementation planning
**Working title:** RollVault — the definitive database of professional grappling

---

## 1. Vision & wedge

RollVault is a living, connected database of professional grappling (BJJ / submission
grappling) — the place someone instinctively visits first. The long-term shape is a
knowledge graph where athletes, matches, events, teams, techniques, instructionals and
news are all connected, and every surface (athlete pages, rankings, GOAT index, news,
stats) is a *view* over that graph.

**The product is not "a knowledge graph." The product is verified, structured,
deduplicated match data that exists nowhere else.** The graph is a modeling choice; the
data is the moat *and* the bottleneck.

### v1 wedge (locked)

- **Primary:** the definitive **records / stats database** — athlete data is the
  foundation; without it nothing else exists (Basketball-Reference model).
- **Secondary:** a **discovery / learning** layer riding on athlete pages — official
  match-video links (YouTube) and instructional **affiliate links** (BJJ Fanatics).
  v1 ships *just the links*, not hosted media, not deep technique tagging.

### v1 scope slice (locked)

- **No-gi elite only:** ADCC (all editions) + ADCC Trials, plus major no-gi superfight
  promotions (WNO, Polaris, CJI, ONE submission grappling).
- **~150–200 athletes.** Deliberately narrow and deep. A shallow database of 100k
  athletes is worthless; a deep, correct database of 200 is a moat.

---

## 2. Key strategic decisions & rationale

### Why editorial-first, not scraping-first (v1 data creation)

Data is entered by a solo/small editorial team through a purpose-built admin. Automated
ingestion is deferred to a later phase. Reasons scraping-first was rejected:

1. **Legal asymmetry.** The richest source (FloGrappling) is paywalled and its ToS
   prohibits automated access. Building a commercial product's core pipeline on scraped
   paywalled content is an existential liability, not a moat. Smoothcomp (public bracket
   pages / organizer API) and BJJ Fanatics (affiliate program) are friendlier; Flo is not.
2. **No schema to extract into yet.** Connectors extract into a *target* shape. The ugly
   edge cases (double-DQ, mid-event ruleset changes, gi+no-gi multi-weight athletes,
   superfight vs bracket, overturned results) must be hand-modeled first. Editorial entry
   is how the real schema is discovered.
3. **Entity resolution needs ground truth.** Scraping yields strings ("J. Ryan",
   "Gordon Ryan", "Gordon 'The King' Ryan"). Collapsing them requires a canonical athlete
   registry to resolve *against* — which only editorial curation produces first.
4. **No validation oracle.** A hand-verified gold set is needed to measure extraction
   accuracy. Editorial v1 *is* that gold set.
5. **Fragmented sources.** No single site holds all pro grappling results; connectors-first
   means N fragile scrapers before any value is proven.

Automation returns later as **Phase D**, built against the schema + entity registry that
editorial v1 produces, using legitimate APIs (YouTube Data API, BJJ Fanatics affiliate,
Smoothcomp organizer API) with human-in-the-loop review. Rule: **automate only after you
know exactly what "correct" looks like.**

---

## 3. Architecture & stack

**Core decision: Postgres as single source of truth (relational-first).** A native graph
DB (Neo4j) is premature — the real v1 queries (record, match history, event results) are
relational. Model entities and relationships as tables; add a graph/analytics layer only
when a real graph *feature* (rivalry discovery, six-degrees) ships.

**v1 stack (deliberately boring):**

| Concern | Choice | Why |
|---|---|---|
| Frontend + backend | Next.js (App Router) | Server-rendered entity pages + colocated admin API; one codebase; matches existing tooling |
| Database | Postgres (Neon or Supabase) | Relational data is the product; JSONB for flexible bits |
| ORM | Drizzle (SQL-first, type-safe) | The schema *is* the product; SQL-first fits |
| Search (v1) | Postgres full-text search | Fast enough at this scale; Meilisearch/Typesense is a drop-in later |
| Hosting | Vercel + managed Postgres | Simple, scales |
| Media | None hosted — link only | Legal safety; YouTube/BJJ Fanatics are linked/embedded, never re-hosted |
| Auth | Admin-only (`is_editor` flag) | No public accounts in v1 |

**Deferred on purpose:** background job queue, ingestion connectors, Neo4j, community
accounts, AI pipeline. None are needed to prove the wedge.

Shape of v1: **read-heavy public pages + a private admin write-path**, data entered by hand.

---

## 4. Data model

### Core entities

```
Athlete ──< AthleteAlias                    (name variants, nicknames — identity registry)
   │
   └──< AthleteTeamMembership >── Team       (TEMPORAL: start/end dates)

Promotion ──< Event ──< Match >── MatchCompetitor >── Athlete
                          │
                          └── ruleset, weight_class, method, duration, match_type, round

Event ──< Placement >── Athlete              (podium / medals per division)

Match ──< Video                              (YouTube link)
Athlete ──< Instructional                    (BJJ Fanatics affiliate link)
```

### Non-obvious modeling decisions (each maps to an edge case)

- **`MatchCompetitor` join, not `competitor_a`/`competitor_b`.** Match row holds shared
  facts (event, ruleset, weight, method, duration); two competitor rows each hold
  `athlete_id` + `outcome` (WON / LOST / DRAW / NC / DQ). Makes "athlete match history" a
  trivial join, kills A-vs-B asymmetry, and handles **draws / no-contests / double-DQs**.
- **Ruleset & weight live on the Match, not the Event.** One event mixes rulesets (ADCC
  regulation vs overtime; CJI's ruleset) and an athlete fights at **multiple weights /
  absolute** in a night. Weight is never an athlete property.
- **`result_method` is rich:** submission type (RNC, heel hook, guillotine…) or POINTS /
  DECISION / DQ / OVERTIME. Powers the submission-breakdown stat for free.
- **`match_type`:** BRACKET (with `round`) vs SUPERFIGHT vs TRIAL vs ALTERNATE.
- **Explicit `Placement` (medals), not purely derived.** Medals are often known without
  every prelim match entered; deriving from matches fails on incomplete brackets. Store
  podium finishes directly; reconcile with match data later.
- **`AthleteAlias` from day one.** The canonical registry future scrapers resolve messy
  strings against — the thing editorial exists to build.
- **`AthleteTeamMembership` is temporal.** In elite no-gi, team moves are the storyline
  (DDS → New Wave, etc.). A single `team_id` would be a lie the moment someone transfers.

Every entity gets a UUID + human slug (`/athlete/gordon-ryan`).

### Deferred entities (YAGNI for v1)

Technique, News, Podcast, Coach-as-entity (a coach is an Athlete/person with a membership
role for now), Ruleset/WeightClass as full tables (start as enums), belt/nationality
(plain fields on Athlete).

### Stat derivation

Record (W–L), finish rate, submission breakdown, rivalries (opponents faced 2+ times) are
all **derived queries** over `MatchCompetitor` + `result_method` — no separate storage.

---

## 5. Admin & curation tooling (the write path)

1. **Writes go through a typed API** (Next.js route handlers → Drizzle), not direct DB
   pokes. This same surface is what AI-assisted entry (Phase D) and community submissions
   (Phase E) will later call. Build the write-path once; swap the caller later.
2. **Entity resolution is first-class UX.** Competitor/team/event fields are typeaheads
   over entity + alias tables; creating a new athlete requires dismissing a "possible
   duplicates" panel. Prevents duplicates at point of entry.
3. **Provenance is mandatory.** Every match/athlete-fact carries `source_url`,
   `verified_by`, `verified_at`, `confidence` (CONFIRMED / NEEDS_REVIEW). Serves
   credibility, audit trail, and a `NEEDS_REVIEW` work queue.
4. **Draft → Published status per entity** + event-centric entry flow (Event → Matches →
   competitors resolved inline → Placements). Nothing half-entered leaks public.

**Lightweight audit:** `created_by/at`, `updated_by/at`, append-only `change_log`
(entity, field, old→new, who, when) — substrate for later moderation.

**Deferred:** rich roles/permissions, review-queue automation, diff-based approvals.

---

## 6. Public pages, search & secondary layer

All views over Section 4 data — no new source-of-truth.

**Pages (server-rendered for SEO — organic search is the growth engine):**

- **Athlete page (hub):** bio header (name, nationality, current team + team-history
  timeline), record (W–L, finish rate, submission breakdown), filterable match-history
  table, placements/medals, match-video library, instructional affiliate cards, rivalries
  (derived).
- **Match page:** competitors, event, ruleset, weight, method, duration, embedded YouTube,
  athlete links, public "Sources · last verified {date}" line.
- **Event page:** promotion, date, venue, full results/bracket, competitors, videos.
- **Promotion page:** its events. **Team page:** current roster + alumni (temporal).

**Search (v1 = Postgres FTS):** typeahead over Athletes (+aliases), Events, Teams,
Promotions.

**Secondary layer:**
- **Video:** official YouTube embeds/links on matches; per-athlete match library. Link /
  embed official uploads only — never re-host.
- **Instructional:** BJJ Fanatics affiliate cards attached to instructor (an Athlete);
  essentials only (title, instructor, thumbnail, affiliate URL) + simple global browse.

**Provenance display decision:** public but understated — collapsible "Sources · last
verified {date}" line. Stored always; entry discipline mandatory regardless.

**SEO baseline:** clean slugs, server rendering, schema.org structured data
(Person / SportsEvent), sitemaps.

**Not in v1:** GOAT Index, rankings, news, technique pages, public accounts, connectors,
AI pipeline.

---

## 7. Phased roadmap (v1 → mature platform)

- **Phase A (v1) — Foundation.** Core data model + admin/curation tooling + entity
  resolution. Editorial entry of the no-gi elite slice. *This spec.*
- **Phase B — Public entity pages + secondary layer.** Athlete/match/event/team/promotion
  pages, video links, instructional affiliate cards, SEO baseline. (Can overlap A.)
- **Phase C — Search.** Postgres FTS → Meilisearch/Typesense if/when needed.
- **Phase D — Assisted ingestion.** AI-assisted entry + first legitimate connectors
  (YouTube Data API, Smoothcomp organizer API, BJJ Fanatics affiliate feed), human-in-loop,
  built against the now-stable schema + entity registry.
- **Phase E — Rankings & community.** Objective leaderboards (titles, medals) first;
  community submissions + moderation; graph layer if a real graph feature ships.
- **Phase F — GOAT Index, news, technique pages, video/match library at scale.** Deferred
  hardest/most-contested features, built only once data breadth + depth justify them.

**Sequencing rule:** breadth (automation) only after depth (quality) is proven on the slice.

---

## 8. Monetization (natural fits, deferred activation)

- **Affiliate instructionals (BJJ Fanatics)** — live conceptually in v1 (links present).
- Later: display advertising, premium memberships, gym/academy listings, event promotion,
  sponsorships, API access, data licensing. All ride on the same dataset; none require
  v1 build.

---

## 9. Explicit non-goals for v1

Not another BJJ news website. No GOAT algorithm, no automated news pipeline, no scraping
connectors, no public accounts, no graph database, no hosted media, no gi coverage, no
technique entities. Each is a named later phase, not a v1 compromise.
