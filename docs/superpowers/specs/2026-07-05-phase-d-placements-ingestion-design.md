# Phase D coverage increment — Placements ingestion

**Date:** 2026-07-05
**Status:** Design (approved for planning)
**Depends on:** Phase D v1 assisted ingestion (`docs/superpowers/specs/2026-07-05-phase-d-assisted-ingestion-design.md`)

## Goal

Widen freeform extraction coverage so a pasted results article also yields
**placements** (tournament results: an athlete placing Nth in a division at an
event), committed as `NEEDS_REVIEW` draft-visibility rows through the existing
ingest review → commit pipeline.

## Why placements (and not teams/memberships) first

The Phase D v1 deferred list was "teams/memberships/placements/videos." On
inspecting the schemas, placements are the highest-value, lowest-friction next
slice:

- **Memberships are a poor fit for freeform text.** `athlete_team_memberships.start_date`
  is `NOT NULL`, but articles rarely state when an athlete joined a team. Most
  membership candidates could never commit, and teams without memberships are
  low-value orphan rows. Revisit once the membership model tolerates an unknown
  start date.
- **Videos** attach to a specific match by `match_id` + `url`; niche and only
  meaningful when matches are created in the same batch.
- **Placements connect two entities we already extract** (athlete + event) and
  need only `division` (text) + `place` (int) beyond those refs — no awkward
  required field. The data ("Gordon Ryan won the 2022 ADCC absolute; Nicky Rod
  took 2nd at +99kg") is exactly what results articles state. Highest value for
  a results/reference site.

## Data model (existing, unchanged)

`placements` table (`src/db/schema/placement.ts`):
`{ id, eventId (FK, notNull), athleteId (FK, notNull), division (text, notNull),
place (smallint, notNull), sourceUrl, verifiedBy, verifiedAt, confidence }`.
Unique constraint `(eventId, athleteId, division)`. **No `status` column** —
public visibility follows the parent event's `status` (see
`src/lib/public/athlete-page.ts`, which joins on `events.status = 'published'`).

Commit uses the existing `addPlacement(db, input)` service
(`src/lib/placements/service.ts`); no new domain service needed.

## Architecture

Placements are an **edge** in the candidate graph (like matches): they reference
an `eventRef` and an `athleteRef` but are not themselves resolved against
existing rows in v1. The slice mirrors the existing
promotion → event → athlete → match pipeline end to end.

### 1. Extraction schema (`src/lib/ingestion/schema.ts`)

```ts
export const PlacementCandidateSchema = z.object({
  localRef: z.string().min(1),
  eventRef: z.string().min(1),
  athleteRef: z.string().min(1),
  division: z.string().min(1),
  place: z.number().int().positive(),
});
```

Add `placements: z.array(PlacementCandidateSchema)` to `ExtractionSchema` and
export the `PlacementCandidate` type. Structured output via
`messages.parse` + `zodOutputFormat` picks up the schema change automatically.

### 2. Extractor (`src/lib/ingestion/extract.ts`)

- `ClaudeExtractor` prompt gains guidance to emit placements when the text
  states tournament results, referencing the event and athlete by their local
  refs and using an integer `place` (1 = champion, 2 = runner-up, 3 = third,
  etc.) and the stated `division`/weight class string.
- `FakeExtractor` gains the ability to return placements so tests can exercise
  the pipeline without an API key.

### 3. Resolution (`src/lib/ingestion/resolve.ts`)

- `ResolvedCandidate.entityType` union gains `"placement"`.
- Placements are emitted like matches: one candidate each, no resolution
  proposal (`resolvedEntityId: null`, `resolvedEntityType: null`,
  `matchScore: null`).

### 4. Commit (`src/lib/ingestion/service.ts`)

- `commitBatch` return type and `counts` gain `placements: number`.
- **Ref pre-validation** (mirrors the match check, so no partial graph is
  written): for every committable placement, its `eventRef` must be in the
  committable-event ref set and its `athleteRef` in the committable-athlete ref
  set; otherwise throw before the transaction.
- New `byType("placement")` loop **after** the athlete loop (needs both
  `eventMap` and `athleteMap` populated). For each, call `addPlacement(stx, {
  eventId: eventMap.get(p.eventRef)!, athleteId: athleteMap.get(p.athleteRef)!,
  division, place, ...provenance })` where provenance is
  `{ confidence: "NEEDS_REVIEW", verifiedBy: batch.createdBy, sourceUrl:
  batch.sourceNote }` — **without** `status` (placements have no status column).
- Record `committedEntityId` on the candidate like matches do.

### 5. Idempotency (duplicate guard)

Placements have a unique `(eventId, athleteId, division)` constraint. A duplicate
on re-ingest would raise inside the transaction and abort the **entire** commit.
To prevent that, before inserting each placement check whether a row with the
same `(eventId, athleteId, division)` already exists; if so, skip it and do
**not** increment the count. This keeps "counts = newly-created rows" and makes
re-commit safe. (Matches keep their existing no-dedup behavior; placements need
the guard because their unique constraint is reachable from typical re-ingests.)

### 6. Route + UI

- The commit route response type gains `placements`.
- `src/app/admin/ingest/[id]/review.tsx`: the candidates table already renders
  `entityType` generically (placements appear automatically). Add `placements`
  to the commit-summary count line.

## Testing (TDD, pglite + FakeExtractor, no API key)

- **schema.test.ts** — a valid placement candidate parses; `place` must be a
  positive integer.
- **resolve.test.ts** — a graph with a placement emits a `"placement"`
  candidate with no resolution proposal.
- **service.test.ts** —
  - event + athlete + placement graph, all accepted → one placement row created,
    `counts.placements === 1`, and the row links the resolved event/athlete IDs.
  - placement referencing a **rejected** athlete or event → `commitBatch`
    throws (ref pre-validation), no rows written.
  - committing the same batch/placement twice → second commit skips the
    duplicate, `counts.placements === 0`, no throw.
- Full suite (`npm test`), `tsc`, and `next build` clean.

## Out of scope (still deferred)

Teams/memberships (blocked on the `start_date NOT NULL` model), videos, URL
fetch/scraping, and the live-extraction end-to-end proof (the `Extractor` seam
remains where CI/tests stub the model).
