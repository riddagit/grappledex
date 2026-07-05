# BJJ Heroes roster/stats backfill — design

**Date:** 2026-07-05
**Status:** ✅ Approved design (ready for implementation plan)
**Pipeline:** #1 of 3 in the bulk data-acquisition vision (roster/stats · YouTube matches · instructionals).
See `docs/superpowers/research/2026-07-05-bulk-data-acquisition-brainstorm.md` for the vision and the
source reverse-engineering.

## Problem

RollVault's DB holds only a ~3-athlete demo seed. To be "the definitive no-gi grappling records
database" it needs real roster + match data. **BJJ Heroes** (bjjheroes.com) is the canonical
community database of pro grapplers and the chosen first source.

## Goals

- Backfill athletes, their teams, competitions/events, and match records from ~1,500 BJJ Heroes
  fighter profiles into RollVault's existing schema.
- Import everything as unpublished **drafts** with source provenance; the clean majority auto-commits,
  and only genuine conflicts land in the existing admin review queue.
- Be idempotent and re-runnable, and a good citizen toward the source.

## Non-goals (explicitly out of scope for this pipeline)

- YouTube match footage and instructional links (pipelines #2 and #3, separate specs).
- Publishing / editorial promotion of imported drafts (a human does that later).
- A recurring scheduler / change-detection. One-time re-runnable backfill only; periodic re-sync is a
  cheap later add-on because the import is idempotent.
- LLM extraction — **deliberately not used here.** The data is already tabular; a deterministic parser
  is cheaper, faster, and more reliable. The Phase D `ClaudeExtractor` stays reserved for messy prose
  sources.

## Locked decisions (from brainstorm)

1. **Import all matches, tag format.** Store every match with `format ∈ {nogi, gi, unknown}`; the UI
   shows and counts only no-gi. Keeps all data; `unknown` is held, not lost.
2. **Auto-import drafts, review conflicts only.** 30k+ rows can't be hand-reviewed. Clean rows commit
   as drafts; only ambiguous entity resolutions / unclassifiable rows go to the review queue.
3. **One-time, re-runnable.** Idempotent upserts; no scheduler.
4. **Good citizen.** Rate-limited single-threaded crawl, honest User-Agent, per-record source
   provenance, and visible "data sourced from BJJ Heroes" attribution.

## Source facts (verified live 2026-07-05)

- **Enumeration:** ~1,511 profile URLs listed across `post-sitemap.xml` (709), `post-sitemap2.xml`
  (424), `post-sitemap3.xml` (378) — filter `<loc>` for `/bjj-fighters/`. The A-Z list page is a JS
  widget and is ignored.
- **Profile record table is inline static HTML**, columns:
  `ID · Opponent · W/L · Method · Competition · Weight · Stage · Year`. The **ID column holds a stable
  unique BJJ Heroes match id** (e.g. 8858, 11346) — used as the cross-profile dedup key.
- **robots.txt** allows everything except `/wp-admin/`; our own fetcher gets HTTP 200. (Anthropic's
  WebFetch infra is host-blocked, irrelevant to our own crawler.)

## Architecture

An offline, re-runnable CLI reusing the existing services, resolution, and review UI. All new code
lives in a self-contained `src/lib/ingestion/bjjheroes/` module. Nothing runs in the serverless
request path.

```
npm run ingest:bjjheroes  (src/lib/ingestion/bjjheroes/backfill.ts)
  → enumerate()      sitemaps → ~1,500 profile URLs
  → for each URL (rate-limited, resumable):
      fetchProfile() → html
      parseProfile(html) → { fighter, records[] }
      load():
        for each record:
          classifyFormat(competition), classifyMatchType(stage)
          resolve chain: promotion → event → athletes(subject, opponent)
          high-confidence  → upsert draft via create* services (idempotent)
          conflict / unknown → write ingestion_candidates on the backfill batch
  → run report (created / skipped / conflict / error counts)
```

### Components (each small, pure where possible, independently testable)

- **`enumerate.ts`** — `fighterProfileUrls(fetch): Promise<string[]>`. Fetches the post-sitemaps,
  filters `/bjj-fighters/`. Tested against a saved sitemap fixture.
- **`parse.ts`** — `parseProfile(html): ParsedProfile`. Pure DOM parse (`jsdom`, already a dep):
  - `fighter`: `{ slug, fullName, nickname?, nationality?, teamName?, weightLabel? }`
  - `records: RecordRow[]` where `RecordRow = { bjjHeroesId, opponentName, outcome, method,
    methodDetail?, competition, weightLabel?, stage?, year }`
  - Tested against saved real profile fixtures incl. edge cases (no record table, missing cells,
    unusual method strings).
- **`classify.ts`** — pure, table-driven:
  - `classifyFormat(competition): "nogi" | "gi" | "unknown"`
  - `classifyMatchType(stage): { matchType: MatchType; round: string | null }`
  - `classifyMethod(raw): { method: MatchMethod; methodDetail: string | null }` (map BJJ Heroes
    method text onto the existing `matches.method` enum).
- **`fetcher.ts`** — polite HTTP: single-threaded, ~1 request / 1.5 s, honest UA
  (`RollVaultIngestBot/1.0 (+https://rollvault.net)` — confirmed 200), timeout, retry-with-backoff,
  and a checkpoint file of processed slugs so `--resume` continues rather than restarts.
- **`load.ts`** — orchestrates resolution + persistence for one parsed profile (below).
- **`backfill.ts`** — CLI entry. Flags: `--limit N`, `--dry-run`, `--resume`. Emits a run report.

### Resolution chain (per record row)

`competition → promotion (resolve/create) → event (resolve/create) → match (create) → 2×
match_competitors (each athlete resolve/create; outcome from W/L)`.

Athlete and event/promotion resolution reuse the Phase D `resolve` layer (exact normalized-name for
athletes/promotions/teams, plus `athlete_aliases`).

## Data-model changes (one migration)

- **`matches.format`** — `text` enum `{nogi, gi, unknown}`, default `unknown`. The field that makes the
  DB filterable to no-gi; only `nogi` matches count toward displayed records.
- **`matches.source_ref`** — `text`, **unique**, nullable. Holds `bjjheroes:<recordId>`. Solves the
  "same match appears on both fighters' profiles" duplication (second sighting is a no-op) and makes
  re-runs idempotent.

No new columns on athletes/events: athletes dedup by unique `slug` (derived from the BJJ Heroes slug
for profile fighters; slugified name for opponent stubs) and events by unique `slug` (derived from
competition + year). `sourceUrl` on each row carries provenance (the profile URL / competition
context). Public UI adds a small "data sourced from BJJ Heroes" attribution where imported data shows.

## Pragmatic calls (accepted)

1. **Opponents become athletes.** Each opponent is resolved/created as an athlete by name (+ aliases).
   Opponents lacking their own profile become minimal draft stubs, enriched later when/if their
   profile is crawled. Order-independent via upsert-by-slug.
2. **Event dates are year-only.** `events.startDate` is NOT NULL `date`; set `YYYY-01-01` and mark the
   event `confidence = NEEDS_REVIEW`. Approximate and explicitly flagged, never shown as exact.
3. **Everything imports as `status=draft`, `confidence=NEEDS_REVIEW`** with `sourceUrl` provenance.
   Nothing publishes automatically.
4. **Conflicts are surfaced, not silent.** Ambiguous athlete resolution, `unknown` format, and
   unmappable stage/method go to `ingestion_candidates` on a dedicated "BJJ Heroes backfill" batch for
   review in the existing admin UI. The clean majority auto-commits.

## Error handling / resilience

- Per-profile `try/catch` → log + skip + count in the run report; one bad page never aborts the run.
- Idempotent upserts (athletes/events by `slug`, matches by `source_ref`) make re-runs safe.
- `--resume` checkpoint of processed slugs.
- Rate-limit + exponential backoff on 429/5xx to stay polite and unblocked.

## Testing

- **Pure units** (`parse`, `classify`, `enumerate`) unit-tested against **saved real fixtures**
  committed under `src/lib/ingestion/bjjheroes/__fixtures__/` (a few profile HTMLs + one sitemap),
  including malformed/edge cases.
- **`load`/resolution**: reuse Phase D patterns; add a test that a duplicate `source_ref` is a no-op
  and that an ambiguous athlete routes to `ingestion_candidates` instead of committing.
- **Idempotency**: running `load` twice on the same profile creates no duplicate matches.
- **Live smoke** (gated, not in CI): `npm run ingest:bjjheroes --limit 5 --dry-run` against the real
  site, to prove enumerate → fetch → parse end-to-end.

## Open follow-ups (later, not this spec)

- Publishing workflow for imported drafts.
- Format classifier coverage will need iteration as unknown competitions surface via the review queue.
- Pipelines #2 (YouTube) and #3 (instructionals) attach to the athletes this pipeline creates.
