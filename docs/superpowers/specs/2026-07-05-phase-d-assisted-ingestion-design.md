# Phase D v1 — Assisted Ingestion (design)

**Date:** 2026-07-05
**Status:** Approved for planning
**Depends on:** Phases A–C (data model, admin write-path, entity resolution, public pages/search).

## Goal

Give editors a faster path to get real BJJ/no-gi data into RollVault than the
manual admin forms: **paste raw text → an LLM extracts structured records → the
editor reviews/edits them in admin → they are committed** into the existing
entity tables. This is the first slice of the broader Phase D vision (scrape →
AI extract → admin review → publish); v1 is scoped to the paste-first path.

## Decisions (locked)

- **Input:** paste raw text in v1. URL fetch / scraping is a later increment.
- **Extraction unit:** freeform — the LLM extracts whatever entities the text
  contains (athletes, promotions, events, matches), routed by type.
- **LLM:** Claude via the Anthropic API. Model defaults to `claude-opus-4-8`
  (override via env). Structured output uses the SDK's structured-outputs path
  (`messages.parse()` + `zodOutputFormat`, i.e. `output_config.format` with a
  JSON schema) — chosen over tool-use because it guarantees schema-valid JSON.
  `thinking: { type: "adaptive" }`; stream for large pastes.
- **Storage:** dedicated staging tables (`ingestion_batches`,
  `ingestion_candidates`). Real entity tables stay clean until commit.
- **Publish gate:** committed rows land as `status: draft`,
  `confidence: NEEDS_REVIEW`. Ingestion never publishes — the editor publishes
  through the existing entity admin. One publish authority; ingest is not a
  publish bypass.

## Scope

**In:** paste UI; Claude extraction into a typed candidate graph; entity-
resolution proposals; staging tables; review queue (edit / accept / merge /
reject per candidate); commit via existing `create*` services.

**Out (later increments):** URL fetch / scraping; per-site connectors; image
handling; bulk CSV import; auto-publish.

## Data flow

1. Editor pastes text at `/admin/ingest` → creates an `ingestion_batches` row
   (`status: extracting`).
2. Server calls Claude with a Zod-schema-constrained request → returns arrays of
   candidate athletes / promotions / events / matches. **Matches reference their
   competitors and event by a within-batch `localRef`** (names, not IDs — real
   IDs don't exist until commit).
3. Each candidate runs through resolution: reuse
   `findDuplicateCandidates` (`src/lib/identity/match.ts`) for athletes;
   name-normalized match for promotions/events. A proposed
   `resolvedEntityId` + `matchScore` is attached where a likely existing entity
   is found. Candidates persist as `ingestion_candidates` (`decision: pending`).
4. Editor reviews at `/admin/ingest/[batchId]`: per candidate — edit the
   payload, **accept** (create new), **merge** (use the resolved existing
   entity), or **reject**.
5. **Commit batch** writes accepted candidates via the existing services in
   dependency order (promotions → events → athletes → matches), resolving
   `localRef`s to real IDs as it goes. Merged candidates contribute their
   resolved existing ID instead of creating a row. Each candidate row records
   its `committedEntityId`. Batch → `committed`.

## New schema (`src/db/schema/ingestion.ts`)

`ingestion_batches`
- `id` uuid pk
- `sourceText` text (the pasted content)
- `sourceNote` text nullable (manual "where this came from"; maps to
  `sourceUrl`/provenance on commit)
- `createdBy` text nullable (ingest actor)
- `status` enum: `extracting | review | committed | failed`
- `model` text (the model id used)
- `error` text nullable (extraction failure detail)
- `createdAt` timestamptz default now

`ingestion_candidates`
- `id` uuid pk
- `batchId` uuid fk → ingestion_batches (cascade delete)
- `entityType` enum: `athlete | promotion | event | match`
- `payload` jsonb (the extracted fields for that entity, sans provenance)
- `localRef` text (stable within-batch key; matches reference athletes/event by
  this)
- `resolvedEntityId` uuid nullable (proposed existing entity)
- `resolvedEntityType` text nullable
- `matchScore` real nullable (resolution confidence 0–1)
- `decision` enum: `pending | accept | merge | reject` (default `pending`)
- `committedEntityId` uuid nullable (set on commit)
- `createdAt` timestamptz default now
- index on `batchId`

## Components

- `src/lib/ingestion/schema.ts` — Zod schemas for the extraction output,
  mirroring `CreateAthleteInput` / `CreatePromotionInput` / `CreateEventInput` /
  `CreateMatchInput` **minus provenance fields** (status/confidence/verifiedBy
  are set by the commit step, not the LLM). Includes the `localRef` linkage for
  matches. These schemas are the single source of truth for both the LLM's
  `output_config.format` and runtime validation.
- `src/lib/ingestion/extract.ts` — an `Extractor` interface
  (`extract(text): Promise<CandidateGraph>`). Default implementation calls Claude
  (`@anthropic-ai/sdk`, `messages.parse` + `zodOutputFormat`, model from env
  default `claude-opus-4-8`, `thinking: adaptive`, streaming for large input).
  **Mockable** — tests inject a fake extractor; the real path reads
  `ANTHROPIC_API_KEY` from `.env.local`. Nothing else in the pipeline depends on
  a live key.
- `src/lib/ingestion/resolve.ts` — `resolveCandidates(db, graph)`: attaches
  resolution proposals to each candidate. Reuses `findDuplicateCandidates` for
  athletes; name-normalized lookup for promotions/events (via `normalizeName`
  in `src/lib/identity/normalize.ts`). Teams/memberships/placements/videos are
  deferred (see Non-goals), so v1 resolves only athlete/promotion/event.
- `src/lib/ingestion/service.ts` — `createBatch`, `runExtraction`,
  `listCandidates`, `setDecision`, `commitBatch`. `commitBatch` maps `localRef`s
  to real IDs and calls the existing `create*` services with
  `status: "draft"`, `confidence: "NEEDS_REVIEW"`, `verifiedBy` = actor.
- API routes: `src/app/api/admin/ingest/route.ts` (POST create+extract),
  `.../ingest/[id]/route.ts` (GET candidates, PATCH a decision),
  `.../ingest/[id]/commit/route.ts` (POST commit).
- Pages: `src/app/admin/ingest/page.tsx` (paste form),
  `src/app/admin/ingest/[id]/page.tsx` (review queue) + a client component for
  per-candidate edit/decision.

## LLM integration details

- New dependency: `@anthropic-ai/sdk`. `zod` is already present.
- Request shape (per the claude-api skill): `client.messages.parse({ model,
  max_tokens: 16000, thinking: { type: "adaptive" }, output_config: { format:
  zodOutputFormat(ExtractionSchema) }, messages: [...] })`. Stream (
  `client.messages.stream`) when input is large, then `finalMessage()`.
- Model id via `INGEST_MODEL` env, default `claude-opus-4-8`. Never construct a
  dated snapshot id.
- Key resolution: `ANTHROPIC_API_KEY` in `.env.local`. If unset, extraction
  fails with a clear message; the rest of the pipeline (review/commit of an
  already-extracted batch) still works.

## Provenance & publish gate

All committed rows: `status: "draft"`, `confidence: "NEEDS_REVIEW"`,
`verifiedBy` = the ingest actor, `verifiedAt` set accordingly. Batch `sourceNote`
(if provided) flows to `sourceUrl` on the created rows. The editor promotes
`draft → published` through the existing entity admin — ingestion has no publish
action.

## Error handling

- Extraction failure → batch `status: failed`, `error` stored, surfaced in the
  UI; the batch is re-runnable.
- Claude output that fails Zod validation → retry once; on second failure, fail
  the batch and store the raw output for debugging.
- `commitBatch` maps `localRef`s inside a transaction; a committed batch cannot
  be re-committed (non-idempotent guard, mirroring the `db:seed` runner).
- Commit ordering guarantees referenced entities (promotion, event, athletes)
  exist or are resolved before a match is written.

## Testing (TDD, pglite + fake extractor)

- `resolve.ts`: unit tests for dedupe/name-match proposals (existing athlete
  matched with score; no false positives).
- `schema.ts`: Zod round-trip tests for the extraction shape, including
  match→localRef linkage.
- `service.ts`: drive `createBatch → runExtraction(fakeExtractor) →
  setDecision(accept/merge/reject) → commitBatch`; assert real rows are created
  via the services with `status: draft` / `confidence: NEEDS_REVIEW`, that
  merged candidates reuse the existing entity, that rejected candidates create
  nothing, and that `committedEntityId` / `localRef` mapping is correct.
- The live Claude call is **not** exercised in CI (no key). The `Extractor`
  interface is the seam where the fake plugs in, so the whole pipeline is
  testable at the pglite level, consistent with the rest of the codebase.

## Non-goals / explicitly deferred

- URL fetching, readability extraction, per-site connectors.
- Auto-publish, bulk CSV, image ingestion.
- Cross-batch dedupe of candidates against each other (v1 resolves each
  candidate against committed data only).
