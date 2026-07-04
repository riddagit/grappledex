# Grappledex Phase A.4 — Secondary Layer (Video + Instructional) Implementation Plan

**Status:** ✅ Complete — implemented on `phase-a4-secondary-layer` (not yet merged;
awaiting explicit OK to merge/push). All 5 tasks done; full suite **83 tests green**,
`tsc --noEmit` clean, `next build` passes (17 pages). This completes the Phase A
foundation: every core §4 entity now has schema + typed write-path + admin surface.

**Goal:** Implement `Video` and `Instructional` — the last two §4 core entities — as
typed, tested schema + write-path services plus admin entry surfaces, completing the
Phase A foundation. Reuses the provenance, no-status, slug, and entity-resolution patterns
from A.1–A.3.

**Design:** `docs/superpowers/specs/2026-07-04-grappledex-phase-a4-secondary-layer-design.md`

**Stack:** unchanged (Next.js 15, Drizzle, postgres-js runtime, pglite tests, Vitest, Zod).
TDD per task: failing test → watch fail → minimal impl → watch pass → commit.

## Global constraints (inherited)

- Postgres is the source of truth; writes go through the typed service layer only.
- Every video/instructional carries the provenance block; **no independent status**
  (inherits parent publication state).
- FKs **restrict** (no cascade); unique constraints prevent exact duplicates.
- Instructor is an Athlete (no separate entity).

---

### Task 1: Video schema + write-path service

- **Create** `src/db/schema/video.ts` — `videos` table: id, matchId fk→matches (indexed,
  restrict), url text notNull, title text nullable, provenance block, timestamps;
  unique(matchId, url). No status. `Video = $inferSelect`, `NewVideo = $inferInsert`.
- **Modify** `src/db/schema/index.ts` — add `export * from "./video";`.
- **Create** `src/lib/videos/service.ts` — `addVideo`, `listVideosForMatch`,
  `listVideosForEvent` (join matches), `listVideosForAthlete` (join match_competitors).
- **Test** `src/db/schema/video.test.ts` (columns present, no `status`);
  `src/lib/videos/service.test.ts` (add → appears in listVideosForMatch; dup (matchId,url)
  rejected; listVideosForAthlete returns via competitor join; listVideosForEvent groups).
- Migration: `npm run db:generate` → `drizzle/0007_*.sql`.
- Commit: `feat: add video schema + write-path service`.

### Task 2: Instructional schema + write-path service

- **Create** `src/db/schema/instructional.ts` — `instructionals` table: id, athleteId
  fk→athletes (indexed, restrict), title text notNull, affiliateUrl text notNull,
  thumbnailUrl text nullable, provenance block, timestamps; unique(athleteId, affiliateUrl).
  No status. `Instructional = $inferSelect`, `NewInstructional = $inferInsert`.
- **Modify** `src/db/schema/index.ts` — add `export * from "./instructional";`.
- **Create** `src/lib/instructionals/service.ts` — `addInstructional`,
  `listInstructionalsForAthlete`, `listInstructionals` (join instructor name/slug →
  `InstructionalWithInstructor`).
- **Test** `src/db/schema/instructional.test.ts` (columns, no `status`);
  `src/lib/instructionals/service.test.ts` (add → per-athlete list; dup (athlete,
  affiliateUrl) rejected; global browse join carries instructor name/slug).
- Migration: `npm run db:generate` → `drizzle/0008_*.sql`.
- Commit: `feat: add instructional schema + write-path service`.

### Task 3: Admin routes + validation

- **Create** `src/app/api/admin/videos/validation.ts` — `AddVideoSchema` (matchId uuid,
  url url, title?, sourceUrl url?, verifiedBy?, confidence enum?).
- **Create** `src/app/api/admin/videos/route.ts` — POST (safeParse → `addVideo`, 201, 400)
  + GET `?matchId=` → `listVideosForMatch`.
- **Create** `src/app/api/admin/instructionals/validation.ts` — `AddInstructionalSchema`
  (athleteId uuid, title min 1, affiliateUrl url, thumbnailUrl url?, provenance optionals).
- **Create** `src/app/api/admin/instructionals/route.ts` — POST (→ `addInstructional`,
  201, 400) + GET `?athleteId=` → `listInstructionalsForAthlete`.
- **Test** `src/app/api/admin/videos/route.test.ts` (valid ok; bad url / non-uuid matchId
  rejected), `src/app/api/admin/instructionals/route.test.ts` (valid ok; empty title / bad
  affiliateUrl / non-uuid athleteId rejected).
- Commit: `feat: add video + instructional admin routes`.

### Task 4: Admin UI

- **Modify** `src/app/admin/events/[id]/page.tsx` — fetch `listVideosForEvent`, render each
  match's videos, and drop a `VideoForm` per match.
- **Create** `src/app/admin/events/[id]/video-form.tsx` — client add-video form (url +
  optional title) posting to `/api/admin/videos`, reload on success.
- **Create** `src/app/admin/athletes/[id]/page.tsx` — athlete hub (mirrors team hub):
  athlete header + instructionals list + `InstructionalForm`; `notFound()` on missing.
  (Needs `getAthlete(db, id)` — add to `src/lib/athletes/service.ts` if absent.)
- **Create** `src/app/admin/athletes/[id]/instructional-form.tsx` — client add-instructional
  form (title, affiliateUrl, optional thumbnailUrl) posting to `/api/admin/instructionals`.
- **Create** `src/app/admin/instructionals/page.tsx` — server global-browse list via
  `listInstructionals`.
- Commit: `feat: add video + instructional admin surfaces`.

### Task 5: Verify + docs + branch ready

- `npm test` (all green), `npx tsc --noEmit` (clean), `npm run build` (Next build passes).
- Update this plan's status + v1 roadmap tracking (Phase A foundation complete).
- **Do not push or merge** — get explicit OK first (per user guidance).
- Commit: `docs: mark Phase A.4 complete`.
