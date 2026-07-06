# Admin Backfill-Drafts Curation View — Design

**Status:** Approved (2026-07-06)

## Problem

The BJJ Heroes backfill (pipeline #1) writes entities directly to the DB as
`status = "draft"` / `confidence = "NEEDS_REVIEW"`: currently 139 athletes, 30
promotions, 57 events, 193 matches from a 3-profile smoke run; the full run will
produce tens of thousands of rows. The public site only renders `published` rows,
and the existing admin surfaces do **not** reach this data:

- Public pages (`/athlete/[slug]`, `/event/[slug]`, `/match/[id]`, search) filter
  `status = "published"` — drafts are invisible by design.
- The ingest review page (`/admin/ingest/[id]`) lists only `ingestion_candidates`
  (the paste-flow model + the backfill's *conflicts*), not the directly-written
  draft entities.
- Admin entity pages (`/admin/athletes/[id]`) need a UUID and have no browse list
  or publish control.

So the backfilled drafts have **no path to the live site**. This feature adds one.

## Goal & Philosophy

**Bulk-trust + spot-check.** The deterministic parser is trusted; the clean
majority is published in sweeps, and the outliers it can't safely auto-publish are
surfaced (read-only) for a later pass. Optimized for scale, not per-row gating.

### v1 scope (intentionally small)

- **Publish is the only mutation.** No editing, no format-tagging, no reject/delete.
- **No schema change.** Uses the existing `status` column on every entity.
- Outliers are **surfaced read-only** with a reason; they stay `draft`.

### Explicitly out of scope for v1

- Inline fixing (set format, reassign an ambiguous opponent, rename "Unknown").
- Reject/hide with a re-import guard (would need a `rejected` state + backfill skip).
- Auth on `/admin` (see Known Limitations).

## Core Rule: publishable vs blocked

A **draft match is publishable** unless a competitor athlete is a non-identity —
`full_name` is empty (`''`) or equals `"Unknown"` (case-insensitive). Those are the
shared-junk rows produced when the source lists an unnamed opponent (observed: one
`"Unknown"` athlete aggregating 6 matches). Publishing such a match would attach a
real fighter's record to a junk identity, so it is **blocked**.

`format = "unknown"` is a **soft flag**, NOT a blocker: the public athlete page does
not read the `format` column at all (verified in `src/lib/public/athlete-page.ts`;
it is a filter tag for future use). Blocking on it would strand ~117 of 193 matches.
Soft-flagged matches are published normally and also counted so they can be tagged
later.

## Publish semantics: cascade in one transaction

Publishing a match sets `status = "published"` on the full minimal graph needed for
clean public rendering:

- the **match** itself,
- its **event**,
- the event's **promotion**,
- **both** competitor athletes.

Rationale (from `athlete-page.ts`): the athlete page inner-joins `matches` on
`status = "published"`; opponent names render regardless of opponent status but
their `/athlete/<slug>` link 404s if the opponent is draft; the event link 404s if
the event is draft. Publishing the whole small graph prevents dangling links.

Properties:

- **Transactional:** all rows in one `db.transaction`; any failure rolls back.
- **Idempotent:** already-published rows stay published; re-running publishes nothing new.
- **Blocked-safe:** blocked matches are skipped and reported in a count, never error.

## Units

Each unit has one purpose, a defined interface, and is independently testable.
Mirrors the existing service-seam style (`src/lib/ingestion/bjjheroes/load.ts`).

### 1. `src/lib/curation/queries.ts` — read model

```ts
export type DraftDashboard = {
  draftAthletes: number;
  draftPromotions: number;
  draftEvents: number;
  publishableMatches: number;   // draft, no Unknown/empty competitor
  blockedMatches: number;       // draft, has an Unknown/empty competitor
  softFlaggedMatches: number;   // publishable AND format = 'unknown'
};
export type BlockedMatch = {
  matchId: string; eventName: string; reason: string; // e.g. "opponent 'Unknown'"
};
export type DraftAthleteSummary = {
  athleteId: string; fullName: string; slug: string;
  publishableMatches: number;   // draft, publishable, this athlete is a competitor
};

export function draftDashboard(db: Db): Promise<DraftDashboard>;
export function blockedMatches(db: Db, limit?: number): Promise<BlockedMatch[]>;
export function draftAthleteSummaries(db: Db, limit?: number): Promise<DraftAthleteSummary[]>;
```

"Non-identity competitor" predicate (shared helper): an athlete whose
`full_name` trimmed is `''` or matches `Unknown` case-insensitively.

### 2. `src/lib/curation/publish.ts` — publish service

```ts
export type PublishResult = {
  matches: number; events: number; promotions: number; athletes: number;
  skippedBlocked: number;
};
export function publishMatches(db: Db, matchIds: string[]): Promise<PublishResult>;
export function publishAllPublishable(db: Db): Promise<PublishResult>;
export function publishAthleteGraph(db: Db, athleteId: string): Promise<PublishResult>;
```

- `publishMatches`: filter the given ids to draft + publishable; cascade-publish the
  graph in a transaction; count distinct rows actually flipped (draft→published).
- `publishAllPublishable`: resolve all publishable draft match ids, then `publishMatches`.
- `publishAthleteGraph`: publish the athlete's publishable draft matches (cascade), and
  ensure the athlete row itself is published even if they have zero publishable matches.

### 3. `src/app/admin/drafts/page.tsx` — server dashboard

Server component. Renders `draftDashboard` counts, a `draftAthleteSummaries` list
(top N by publishable-match count), and a read-only `blockedMatches` section with
reasons. Passes data to the client action component. Styled with the existing admin
inline-style convention (plain, functional — matches `/admin/ingest`).

### 4. `src/app/admin/drafts/publish-actions.tsx` — client component

`"use client"`. Buttons:
- **Publish all publishable** → `POST /api/admin/publish { scope: "all" }`.
- Per athlete row: **Publish this athlete's graph** → `POST { scope: "athlete", athleteId }`.

On success shows the returned `PublishResult` summary and triggers a refresh
(`router.refresh()`), so counts update. The Blocked section is display-only.

### 5. `src/app/api/admin/publish/route.ts` — endpoint

`POST` with body validated by zod: `{ scope: "all" } | { scope: "athlete", athleteId: uuid }`.
Dispatches to the publish service, returns `PublishResult` (200) or `{ error }` (400/500).
Follows the existing `src/app/api/admin/*/route.ts` + `validation.ts` pattern.

## Data flow

```
/admin/drafts (server)
  -> queries.draftDashboard / draftAthleteSummaries / blockedMatches
  -> render dashboard + <PublishActions/>
user clicks Publish
  -> POST /api/admin/publish { scope, athleteId? }
  -> publish.publishAll / publishAthleteGraph  (transaction, cascade, skip blocked)
  -> PublishResult
  -> client shows summary + router.refresh() -> counts update
```

## Error handling

- Publish runs in a single transaction; on any DB error it rolls back and the route
  returns `{ error }` with 500.
- Invalid request body → 400 from zod validation.
- Blocked matches are never errors — they are filtered out and counted in
  `skippedBlocked`.
- Re-publishing an already-published graph is a no-op (counts reflect 0 new).

## Testing (TDD, pglite via `createTestDb`)

- **queries.test.ts:** seed a mix of draft/published athletes+matches incl. an
  `"Unknown"` opponent; assert dashboard counts, `blockedMatches` reason, and
  per-athlete summary numbers.
- **publish.test.ts:**
  - `publishMatches` flips match + event + promotion + both athletes to published;
  - a match with an `"Unknown"` competitor is skipped (`skippedBlocked` incremented,
    not published);
  - idempotent: re-publishing yields a zero-change result;
  - `publishAthleteGraph` publishes the athlete + their publishable matches and skips
    their blocked ones.
- **route.test.ts:** `{ scope: "all" }` happy path returns a `PublishResult`; invalid
  body → 400. (Mirrors existing admin route tests.)

Full suite (`npm test`) and `npx tsc --noEmit` must stay green.

## Known Limitations

- **No auth.** `/admin` and `/api/admin/*` are currently open (single-user local
  tool); this adds another mutating open endpoint, consistent with the existing
  create routes. Real auth is a separate, larger concern — not addressed here.
- **Publish is one-way in v1** (no unpublish/reject). Reverting is a manual DB update
  for now.
- **"Unknown"/empty is the only blocked-identity heuristic.** Other junk names would
  publish; broadening the predicate is a later refinement.

## Future iterations (not now)

- Inline outlier fixing (set format, reassign ambiguous opponent, rename "Unknown").
- Reject/hide + backfill re-import guard (needs a `rejected` state).
- Auth for `/admin`.
- Filter/search within the drafts dashboard as volume grows.
