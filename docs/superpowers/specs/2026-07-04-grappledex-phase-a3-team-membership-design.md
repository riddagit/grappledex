# Grappledex Phase A.3 — Team + Temporal Membership (Design)

**Date:** 2026-07-04
**Status:** Approved (decisions locked in v1 spec §4) → ready for implementation
**Depends on:** Phase A.1 (athlete core), Phase A.2 (competition core)

---

## 1. Why this phase

The v1 data model (v1 design §4) names **Team** and a **temporal
`AthleteTeamMembership`** as core Phase A entities and explicitly calls the temporal
membership a non-obvious modeling decision:

> **`AthleteTeamMembership` is temporal.** In elite no-gi, team moves are the storyline
> (DDS → New Wave, etc.). A single `team_id` would be a lie the moment someone transfers.

They are the last core Phase A foundation entity not yet built. They power the athlete
page's **team-history timeline** and the **team page** (current roster + alumni) planned
in Phase B. This phase adds the schema, the typed write-path, and an athlete-typeahead
admin surface — reusing the entity-resolution, provenance, and draft/publish patterns
proven in A.1/A.2.

Coach-as-entity stays deferred: a coach is an Athlete with a membership `role`
(v1 spec §4 "Deferred entities").

---

## 2. Entities

### `teams`

Mirrors `promotions` exactly — a public, sluggable, draft/published entity with the
provenance block.

- `id` uuid pk, `slug` text unique, `name` text, `shortName` text nullable
- provenance: `sourceUrl`, `verifiedBy`, `verifiedAt`, `confidence` (default `NEEDS_REVIEW`)
- `status` (`draft` | `published`, default `draft`)
- `createdAt`, `updatedAt`

### `athlete_team_memberships` (temporal)

- `id` uuid pk
- `athleteId` uuid fk → `athletes.id` (indexed)
- `teamId` uuid fk → `teams.id` (indexed)
- `role` text nullable — free-text (e.g. `competitor`, `coach`); **not an enum** (rich
  roles deferred, mirrors how `weightClass`/`ruleset` are free-text in A.2)
- `startDate` date (required)
- `endDate` date nullable — **null means current membership**
- provenance block (`sourceUrl`, `verifiedBy`, `verifiedAt`, `confidence`)
- `createdAt`, `updatedAt`
- **unique(athleteId, teamId, startDate)** — prevents exact duplicate rows while
  preserving temporal history (mirrors A.2 `placements` unique(event, athlete, division))

---

## 3. Locked decisions (defensible defaults, noted)

1. **No independent `status` on membership.** Like A.2 `placements`, a membership is a
   relationship fact tracked by provenance; it inherits the publication state of its
   athlete/team rather than carrying its own draft/published flag.
2. **`role` is free-text nullable**, not a closed enum — rich roles/permissions are a
   named deferral in v1 spec §5.
3. **FKs restrict (no cascade delete).** Foundation data; membership rows should never
   be silently destroyed by an athlete/team delete. (Contrast A.1 `athlete_aliases`,
   which cascade because an alias is meaningless without its athlete; a membership is an
   independently meaningful historical fact.)
4. **Temporal overlap is allowed.** An athlete may hold overlapping memberships (e.g. a
   competitor row and a coaching row, or historical + current). We prevent only exact
   duplicates via the unique constraint; we do not enforce a single-current-team rule —
   real data (dual roles, contested transfer dates) makes that a lie.
5. **Transfers are modeled by ending the old membership and adding a new one**, not by
   mutating `teamId`. `endMembership(id, endDate)` stamps `endDate`; a fresh
   `addMembership` opens the new tenure.

---

## 4. Write-path (typed service layer)

`src/lib/teams/service.ts`
- `createTeam(db, input): Promise<Team>` — unique slug from name, stamps `verifiedAt`.
- `searchTeams(db, q): Promise<{ id; name; slug }[]>`
- `getTeam(db, id): Promise<Team | null>`

`src/lib/memberships/service.ts`
- `addMembership(db, input): Promise<Membership>`
- `endMembership(db, id, endDate): Promise<Membership>`
- `listMembershipsForAthlete(db, athleteId): Promise<MembershipWithTeam[]>` — the
  team-history timeline, joined to team name/slug, current (null endDate) first then by
  `startDate` descending.
- `teamRoster(db, teamId): Promise<{ current: RosterEntry[]; alumni: RosterEntry[] }>` —
  current = memberships with null `endDate`; alumni = the rest; each joined to athlete
  name/slug.

All writes go through these services; routes/UI never touch Drizzle directly (spec §5).

---

## 5. Admin surface (athlete-centric, reusing A.1 typeahead)

- `POST /api/admin/teams` (Zod → `createTeam`, `201`) · `GET /api/admin/teams?q=`
- `POST /api/admin/memberships` (Zod → `addMembership`, `201`)
- `/admin/teams/new` — create-team form (mirrors promotion form)
- `/admin/teams/[id]` — **team hub**: renders current roster + alumni and an
  *add member* form whose athlete field is a typeahead over `GET /api/admin/athletes`
  (reuses A.1 search + the duplicate-gate athlete registry). Parallels the A.2 event hub.

---

## 6. Out of scope (deferred)

Team page public rendering (Phase B), membership editing/deletion UI beyond add + end,
`change_log` audit substrate, rich role enums/permissions.
