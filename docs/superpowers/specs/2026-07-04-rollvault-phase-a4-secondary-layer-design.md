# RollVault Phase A.4 — Secondary Layer: Video + Instructional (Design)

**Date:** 2026-07-04
**Status:** Approved (decisions locked in v1 spec §4, §6) → ready for implementation
**Depends on:** Phase A.1 (athlete core), A.2 (competition core), A.3 (team + membership)

---

## 1. Why this phase

`Video` (YouTube link on a match) and `Instructional` (BJJ Fanatics affiliate link on
an instructor-athlete) are the last two entities named in the v1 data model (§4) that are
not yet built. They are the **secondary "discovery / learning" layer** (§1, §6): v1 ships
*just the links*, never hosted media.

> **Video:** official YouTube embeds/links on matches; per-athlete match library. Link /
> embed official uploads only — never re-host.
> **Instructional:** BJJ Fanatics affiliate cards attached to instructor (an Athlete);
> essentials only (title, instructor, thumbnail, affiliate URL) + simple global browse.

Building them now completes the Phase A foundation (schema + typed write-path + admin
surface for every core entity) before Phase B renders any public page. Both reuse the
provenance, no-independent-status, and entity-resolution patterns proven in A.2/A.3.

---

## 2. Entities

### `videos` (child of Match)

- `id` uuid pk
- `matchId` uuid fk → `matches.id` (indexed, **restrict**)
- `url` text (the YouTube link) — required
- `title` text nullable
- provenance block (`sourceUrl`, `verifiedBy`, `verifiedAt`, `confidence` default
  `NEEDS_REVIEW`)
- `createdAt`, `updatedAt`
- **unique(matchId, url)** — prevents the same clip attached twice while allowing a match
  to have several videos (mirrors A.2 `placements` unique).
- **No `status` column** — inherits the match's publication state.

The **per-athlete match video library** (§6) is a derived query: `videos → matches →
match_competitors` filtered by `athlete_id`. No stored athlete link on the video.

### `instructionals` (child of Athlete = instructor)

- `id` uuid pk
- `athleteId` uuid fk → `athletes.id` (indexed, **restrict**) — the instructor
- `title` text — required
- `affiliateUrl` text (BJJ Fanatics affiliate link) — required
- `thumbnailUrl` text nullable
- provenance block (`sourceUrl`, `verifiedBy`, `verifiedAt`, `confidence`)
- `createdAt`, `updatedAt`
- **unique(athleteId, affiliateUrl)** — one product listed once per instructor.
- **No `status` column** — inherits the instructor's publication state.

---

## 3. Locked decisions (defensible defaults, noted)

1. **No independent `status`.** Like A.2 `placements` and A.3 memberships, a video /
   instructional is a fact tracked by provenance; it inherits the publication state of its
   parent (match / athlete) rather than carrying its own draft/published flag.
2. **FKs restrict (no cascade).** Both are curated, independently meaningful artifacts
   (a real YouTube upload; a real product with an affiliate payout). They must never be
   silently destroyed by a parent delete — same rationale as A.3 memberships and A.2
   placements. (Contrast `athlete_aliases` / `match_competitors`, which cascade because
   they are meaningless without their parent row.)
3. **URL is stored raw, validated as a URL at the route boundary (Zod `.url()`).** No
   provider-specific parsing / embed-ID extraction in v1 — that is a Phase B/D concern.
   "Official uploads only" is an editorial discipline, not a code constraint here.
4. **Instructor is an Athlete.** No separate Instructor entity — matches v1 spec §4
   "Coach-as-entity … is an Athlete for now". The affiliate card hangs off `athleteId`.
5. **No public rendering.** Public video embeds / affiliate cards on athlete & match pages
   are Phase B. A.4 delivers schema + write-path + admin entry only.

---

## 4. Write-path (typed service layer)

`src/lib/videos/service.ts`
- `addVideo(db, input): Promise<Video>` — input `{ matchId; url; title?; sourceUrl?;
  verifiedBy?; confidence? }`; stamps `verifiedAt` when `verifiedBy` set.
- `listVideosForMatch(db, matchId): Promise<Video[]>`
- `listVideosForEvent(db, eventId): Promise<Video[]>` — join through matches; powers the
  event-hub per-match rendering in one query.
- `listVideosForAthlete(db, athleteId): Promise<Video[]>` — the per-athlete match video
  library; join `videos → match_competitors` on matchId.

`src/lib/instructionals/service.ts`
- `addInstructional(db, input): Promise<Instructional>` — input `{ athleteId; title;
  affiliateUrl; thumbnailUrl?; sourceUrl?; verifiedBy?; confidence? }`.
- `listInstructionalsForAthlete(db, athleteId): Promise<Instructional[]>`
- `listInstructionals(db): Promise<InstructionalWithInstructor[]>` — global browse, joined
  to instructor `fullName`/`slug`.

All writes go through these services; routes/UI never touch Drizzle directly (spec §5).

---

## 5. Admin surface

- `POST /api/admin/videos` (Zod → `addVideo`, 201) · `GET /api/admin/videos?matchId=`
- `POST /api/admin/instructionals` (Zod → `addInstructional`, 201) ·
  `GET /api/admin/instructionals?athleteId=`
- **Event hub** (`/admin/events/[id]`): each match now lists its videos and gets a compact
  `VideoForm` posting to `/api/admin/videos`. (Videos are entered where matches live.)
- **Athlete hub** (`/admin/athletes/[id]`) — **new page**, mirrors the A.3 team hub:
  renders the athlete's instructionals + an `InstructionalForm`.
- **Global browse** (`/admin/instructionals`): server-rendered list via
  `listInstructionals` (spec §6 "simple global browse").

---

## 6. Out of scope (deferred)

Public video embeds & affiliate cards (Phase B), video/instructional edit & delete UI,
provider-specific URL parsing / embed rendering, thumbnail fetching, affiliate-tag
injection, `change_log` audit substrate, independent publication of a video/instructional.
