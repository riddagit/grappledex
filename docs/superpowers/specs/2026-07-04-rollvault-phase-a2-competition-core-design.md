# RollVault — Phase A.2 Design Spec: Competition Core

**Date:** 2026-07-04
**Status:** Approved (brainstorming complete) → ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-07-03-rollvault-v1-design.md`
**Builds on:** Phase A.1 — Athlete identity core (merged to `master`)

---

## 1. What this phase is

Phase A.1 delivered the **athlete identity core** (Athlete + AthleteAlias + entity
resolution + typed write-path + admin entry UI). Phase A.2 delivers the **competition
core** — the verified, structured, deduplicated match data that is the actual product moat:

```
Promotion ──< Event ──< Match ──< MatchCompetitor >── Athlete
                          │
                          └── match_type, weight_class, ruleset, method, duration, round
Event ──< Placement >── Athlete                       (podium / medals per division)
```

Five new entities, their typed write-path, and an **event-centric admin flow**
(Event → Matches → competitors resolved inline → Placements). It reuses A.1's conventions
verbatim: UUID primary keys, human slugs on public entities, mandatory provenance fields,
`draft`/`published` status, typed `Db`-taking service functions, and entity resolution at
the point of entry.

### In scope

- Schema + migration for `promotions`, `events`, `matches`, `match_competitors`, `placements`.
- Typed write-path services for each, with `createMatch` running in a transaction.
- Event-centric admin UI: create promotion, create event, and an event hub for adding
  matches (with athlete typeahead + inline duplicate gate reusing A.1) and placements.
- Tests on the A.1 pglite + Vitest harness, including a derived-stat sanity query.

### Explicitly deferred (each a later slice, consistent with A.1's discipline)

- **Team + temporal `AthleteTeamMembership`** — bio-adjacent; not needed to record results.
- **Video / Instructional links** — the secondary discovery layer (parent-spec Phase B).
- **Append-only `change_log` + `created_by`/`updated_by`** — A.1 did not build these; the
  provenance fields (`source_url`, `verified_by`, `verified_at`, `confidence`) remain the
  audit substrate for now. A dedicated audit slice hardens this later.
- **Formal enum / lookup tables** for weight class and ruleset (see §3 decision).
- Any public-facing pages (parent-spec Phase B).

---

## 2. Data model

All of the "non-obvious modeling decisions" below trace directly to parent-spec §4. New
tables follow the A.1 column pattern; the shared **provenance block** is:
`source_url text?, verified_by text?, verified_at timestamptz?, confidence
('CONFIRMED' | 'NEEDS_REVIEW') default 'NEEDS_REVIEW'`.

### `promotions` (~5 rows: ADCC, WNO, Polaris, CJI, ONE)

| column | type | notes |
|---|---|---|
| id | uuid pk | `defaultRandom()` |
| slug | text unique not null | e.g. `adcc` |
| name | text not null | e.g. "Abu Dhabi Combat Club" |
| short_name | text? | e.g. "ADCC" |
| *provenance block* | | |
| status | `draft`/`published` not null default `draft` | |
| created_at / updated_at | timestamptz not null default now() | |

### `events` (e.g. "ADCC 2022 World Championship", "ADCC West Coast Trials 2024")

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| slug | text unique not null | e.g. `adcc-2022-world-championship` |
| promotion_id | uuid not null → promotions | index |
| name | text not null | |
| start_date | date not null | |
| end_date | date? | multi-day events (ADCC Worlds is 2 days) |
| venue | text? | e.g. "Virgin Hotels Las Vegas" |
| location | text? | e.g. "Las Vegas, NV, USA" |
| *provenance block* | | |
| status | `draft`/`published` not null default `draft` | |
| created_at / updated_at | timestamptz | |

### `matches` (shared match facts; competitors live in the join)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| event_id | uuid not null → events | index |
| match_type | `BRACKET` \| `SUPERFIGHT` \| `TRIAL` \| `ALTERNATE` (enum) not null | |
| round | text? | only meaningful for BRACKET, e.g. `FINAL`, `SF`, `QF`, `R16` |
| weight_class | text? | e.g. `-88kg`, `Absolute`, `Catchweight 185lb` (see §3) |
| ruleset | text? | e.g. `ADCC`, `ADCC Overtime`, `EBI Overtime`, `Sub-only` (see §3) |
| method | `SUBMISSION` \| `POINTS` \| `DECISION` \| `DQ` \| `OVERTIME` \| `FORFEIT` \| `NC` \| `DRAW` (enum) not null | how the match resolved |
| method_detail | text? | specific submission when `method = SUBMISSION`, e.g. `RNC`, `inside heel hook`, `guillotine` |
| duration_seconds | integer? | match length, for stats |
| *provenance block* | | |
| status | `draft`/`published` not null default `draft` | |
| created_at / updated_at | timestamptz | |

No `slug` on matches — they are addressed via their event + competitors, not directly
typed by editors. (Public match URLs, if needed later, derive from event slug + id.)

### `match_competitors` (the join — kills A-vs-B asymmetry)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| match_id | uuid not null → matches (**on delete cascade**) | index |
| athlete_id | uuid not null → athletes | index |
| outcome | `WON` \| `LOST` \| `DRAW` \| `NC` \| `DQ` (enum) not null | |
| slot_order | smallint? | 1 / 2 for stable "A vs B" display ordering |
| | | **unique(match_id, athlete_id)** |

Two rows per match in normal cases; the join handles draws, no-contests, and double-DQs
(both rows `DRAW`/`NC`/`DQ`) without special-casing. `on delete cascade` means deleting a
match cleans up its competitor rows.

### `placements` (medals per division — stored, not derived)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| event_id | uuid not null → events | index |
| athlete_id | uuid not null → athletes | index |
| division | text not null | weight class or `Absolute` — placements are per division |
| place | smallint not null | 1 = gold, 2 = silver, 3 = bronze |
| *provenance block* | | |
| created_at / updated_at | timestamptz | |
| | | **unique(event_id, athlete_id, division)** |

Placements have provenance but **no independent `draft`/`published`** — they are child
records of an event and inherit its publication state. Stored directly (per parent-spec
§4) because medals are often known without every prelim match entered; deriving from
matches fails on incomplete brackets.

### Non-obvious decisions (traceable to parent-spec §4)

- **`MatchCompetitor` join, not `competitor_a`/`competitor_b`.** Trivial "athlete match
  history" join; symmetric; handles draws / NC / double-DQ.
- **Weight and ruleset live on the Match, not the Event.** One event mixes rulesets and an
  athlete fights multiple weights / absolute in a night.
- **`method` + `method_detail`** powers the submission-breakdown stat for free.
- **Explicit `Placement`**, reconciled with match data later rather than derived now.

---

## 3. Key design decision: `weight_class` and `ruleset` are text, not enums

The parent spec floated "Ruleset / WeightClass as full tables (start as enums)." For v1
this phase deliberately models both as **curated free-text columns**, surfaced in the admin
UI as dropdowns of known values with an "other" escape hatch.

**Rationale:** cross-promotion reality is genuinely messy — ADCC kg classes vs WNO
catchweights (often in lb) vs Absolute; ADCC regulation vs ADCC overtime vs EBI/CJI
rulesets. The editorial-first thesis is *"let entry discover the schema before you lock
it."* Committing to a Postgres enum or lookup table now risks migration churn every time a
new promotion's convention appears. Text columns let editors record reality faithfully;
formalizing into enums / lookup tables becomes a cheap, well-informed hardening pass once
the real spread is visible in the data.

Enums *are* used where the value set is closed and stable: `match_type`, `outcome`, and
`method`.

---

## 4. Write-path services

Each mirrors `src/lib/athletes/service.ts`: pure functions taking a `Db` handle, typed
input objects, slug generation via the existing `slugify` + `uniqueSlug` pattern for
public entities.

- **`src/lib/promotions/service.ts`** — `createPromotion(db, input)`, `searchPromotions(db, q)`.
- **`src/lib/events/service.ts`** — `createEvent(db, input)` (requires `promotionId`),
  `searchEvents(db, q)`.
- **`src/lib/matches/service.ts`** — `createMatch(db, input)` inserts the match row and its
  two `match_competitors` rows **atomically in a transaction**; rolls back cleanly if any
  competitor insert fails. Competitors are supplied as resolved `athleteId`s plus outcome.
- **`src/lib/placements/service.ts`** — `addPlacement(db, input)`.

Entity resolution: promotions (~5) and events are chosen via name-search typeaheads;
competitors reuse A.1's `searchAthletes` and its duplicate-detection gate so a
not-yet-existing athlete can be created inline without leaving the match form. Events get a
light exact-name-plus-promotion warning to discourage duplicate event rows; promotions are
few enough that a simple existing-name check suffices.

---

## 5. Admin flow (event-centric, per parent-spec §5.4)

- **`/admin/promotions/new`** — minimal form (name, short name, provenance).
- **`/admin/events/new`** — pick or create a promotion (typeahead), then event fields.
- **`/admin/events/[id]`** — the **entry hub**. Shows the event, and inline sections to:
  - **Add match** — match_type, weight_class, ruleset (dropdown + other), two competitors
    via athlete typeahead (with A.1's inline duplicate gate for new athletes), outcome per
    competitor, method + method_detail, round, duration, provenance.
  - **Add placement** — athlete typeahead, division, place, provenance.

Provenance discipline matches A.1: every match and placement carries `source_url` /
`verified_by`, and the confidence defaults to `NEEDS_REVIEW`. The duplicate-check gate
pattern from A.1 (must dismiss a "possible duplicates" panel before creating a new athlete)
is reused unchanged for inline competitor creation.

---

## 6. Testing

On the existing pglite + Vitest harness (`src/db/test-db.ts`):

- **Schema round-trips** for each new table (insert → select, FK integrity).
- **`createMatch` transaction atomicity** — a failing competitor insert rolls back the
  match row (no orphan match).
- **Unique-constraint enforcement** — duplicate `match_competitors(match_id, athlete_id)`
  and duplicate `placements(event_id, athlete_id, division)` are rejected.
- **Cascade** — deleting a match removes its `match_competitors` rows.
- **Derived-stat sanity query** — a W–L record and submission-breakdown query over
  `match_competitors` + `matches.method` for a seeded athlete, proving the join earns its
  keep (this is the query the future athlete page depends on).

---

## 7. Success criteria

1. Migration applies cleanly; all five tables exist with the constraints above.
2. `tsc --noEmit` clean; full Vitest suite green (A.1's 25 tests + the new ones).
3. An editor can, through the admin UI end-to-end: create a promotion → create an event →
   add a match with two resolved competitors and a submission method → add a placement —
   with provenance captured throughout.
4. A record + submission-breakdown query returns correct numbers for a seeded athlete.

---

## 8. Sequencing note for planning

Natural dependency order (each buildable and testable in isolation, mirroring A.1's
task-per-entity rhythm): promotions schema+service → events schema+service → matches +
match_competitors schema+service (the transaction is the meatiest task) → placements
schema+service → admin UI (promotion form → event form → event hub with match/placement
entry). The admin UI is the last, integrative slice. The writing-plans step breaks this
into reviewed, individually-committed tasks.
