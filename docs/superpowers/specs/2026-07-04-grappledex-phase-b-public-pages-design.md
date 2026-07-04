# Grappledex Phase B — Public Entity Pages + Secondary Layer (Design)

**Date:** 2026-07-04
**Status:** In progress — functional structure locked in v1 spec §6; **visual/aesthetic
direction pending user confirmation** (see §5).
**Depends on:** Phase A (A.1–A.4) — every core entity now has schema + write-path.

---

## 1. Why this phase

A.1–A.4 built the data model and a private admin write-path. Nothing is public yet. Phase B
turns the data into the **read-heavy, server-rendered public pages** that are the product's
growth engine (organic search) — the Basketball-Reference-style surface (v1 spec §1, §6).

**All pages are views over Section-4 data — no new source of truth.** This phase adds a
read/query layer, the page routes, a shared visual design system, seed data for
verification, and the SEO baseline.

---

## 2. Page inventory (spec §6)

| Route | Page | Core content |
|---|---|---|
| `/athlete/[slug]` | **Athlete hub** (most important) | bio header (name, nationality, current team + team-history timeline); record (W–L, finish rate, submission breakdown); filterable match-history table; placements/medals; match-video library; instructional affiliate cards; rivalries (derived) |
| `/match/[id]` | Match | competitors, event, ruleset, weight, method, duration, embedded YouTube, athlete links, "Sources · last verified {date}" |
| `/event/[slug]` | Event | promotion, date, venue, full results, competitors, videos |
| `/promotion/[slug]` | Promotion | its events |
| `/team/[slug]` | Team | current roster + alumni (temporal) |
| `/` | Landing | minimal: what Grappledex is + entry points (deep pages are the SEO surface) |

**Publication filter:** public pages render **only `published` entities**; `draft` rows
404 publicly. Memberships/placements/videos/instructionals inherit their parent's state.

---

## 3. Read/query layer (aesthetic-independent, built first)

New `src/lib/public/` read functions (assemble by slug/id; reuse A.1–A.4 services where they
exist, e.g. `athleteRecord`, `listVideosForAthlete`, `listMembershipsForAthlete`):

- `getAthletePage(db, slug)` → `{ athlete, record, finishRate, submissionBreakdown,
  matchHistory[], placements[], teamTimeline[], videos[], instructionals[], rivalries[] }`
  or `null` (missing / not published).
- `getMatchPage(db, id)`, `getEventPage(db, slug)`, `getPromotionPage(db, slug)`,
  `getTeamPage(db, slug)`.
- **Rivalries (derived):** opponents faced 2+ times, computed from `match_competitors`.
- **Finish rate / submission breakdown:** derived from the existing `athleteRecord` +
  method grouping; no new storage (spec §4 "stat derivation").

All are pure queries, fully testable against in-process pglite — no visual dependency.

## 4. Seed data

`src/db/seed.ts` — DB-agnostic `seed(db)` inserting a small **real no-gi slice** (a handful
of published athletes, a promotion + event, several matches with competitors, placements, a
team + memberships, a video, an instructional). Purpose: make pages verifiable in tests and
in a real dev DB. Also the fixture the read-layer tests assert against.

**Environment note:** there is no local Postgres in this workspace (build hits
`ECONNREFUSED`); runtime pages need a `DATABASE_URL`. Verification in this phase is
test-level (pglite) until a dev DB is provisioned.

---

## 5. Visual design — DIRECTION PENDING

This is the product's first public look. The functional layout is locked (§2); the
**aesthetic identity is a user decision** and is deliberately not guessed here. Candidate
directions to confirm:

- **A — Reference/data-dense** (Basketball-Reference / Sherdog lineage): tight tables,
  high information density, utilitarian, fast. Signals "authoritative database."
- **B — Editorial/premium** (modern sports media): generous type, strong athlete imagery,
  card-driven, more brand personality.
- **C — Minimal/technical** (clean neutral, restrained palette, system-ish type): lets the
  data speak; cheapest to build well; easy to evolve.

Once chosen, the design system (tokens, type scale, color, table + card components) is built
with the `frontend-design` skill, theme-aware (light/dark), before the page chrome.

---

## 6. SEO baseline (spec §6)

Clean slugs (already on every entity), full server rendering, schema.org structured data
(`Person` for athletes, `SportsEvent` for events), `sitemap.xml`, `robots.txt`, per-page
`<title>`/meta/OpenGraph. Provenance shown as an understated collapsible
"Sources · last verified {date}" line.

---

## 7. Increment sequencing

- **B.1 — Foundation (this branch, now):** public read layer + seed data (TDD, no visual
  dependency). *Started.*
- **B.2 — Design system + Athlete page:** confirm direction (§5), build tokens/components,
  ship `/athlete/[slug]` + landing. The keystone page.
- **B.3 — Match + Event + Promotion + Team pages.**
- **B.4 — SEO baseline:** structured data, sitemap, robots, metadata.
- **Search (Phase C)** stays separate.

---

## 8. Out of scope (deferred)

Search (Phase C), rankings/GOAT/news (Phase E/F), public accounts, video *hosting*
(embed/link only), instructional catalog beyond simple cards, image hosting/CDN, i18n.
