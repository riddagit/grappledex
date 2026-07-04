# Grappledex Phase A.3 — Team + Temporal Membership Implementation Plan

**Goal:** Implement Team and temporal AthleteTeamMembership — typed, tested schema +
write-path services plus an athlete-typeahead team-hub admin flow — reusing the
provenance, draft/publish, slug, and entity-resolution patterns from A.1/A.2.

**Design:** `docs/superpowers/specs/2026-07-04-grappledex-phase-a3-team-membership-design.md`

**Stack:** unchanged from A.1/A.2 (Next.js 15, Drizzle, postgres-js runtime, pglite tests,
Vitest, Zod). TDD per task: failing test → watch fail → minimal impl → watch pass → commit.

## Global constraints (inherited)

- Postgres is the source of truth; writes go through the typed service layer only.
- Every team fact carries the provenance block; teams have `draft`→`published` status.
- Memberships have **no** independent status (inherit athlete/team publication state).
- `role` is free-text nullable; FKs restrict (no cascade); temporal overlap allowed;
  unique(athleteId, teamId, startDate) prevents exact duplicates.

---

### Task 1: Team schema + write-path service

- **Create** `src/db/schema/team.ts` — `teams` table mirroring `promotions` (id, slug
  unique, name, shortName, provenance block, status draft/published, timestamps).
  `Team = $inferSelect`, `NewTeam = $inferInsert`.
- **Modify** `src/db/schema/index.ts` — add `export * from "./team";`.
- **Create** `src/lib/teams/service.ts` — `createTeam` (unique slug w/ `-2`,`-3`…
  disambiguation, stamps `verifiedAt` when `verifiedBy` set), `searchTeams` (ilike, limit
  10), `getTeam` (by id or null). `CreateTeamInput` = { name; shortName?; sourceUrl?;
  verifiedBy?; confidence?; status? }.
- **Test** `src/db/schema/team.test.ts` (column presence), `src/lib/teams/service.test.ts`
  (derived slug + verification stamp + draft default; slug collision → `-2`; search by
  substring; getTeam by id and null miss).
- Migration: `npm run db:generate` → `drizzle/0005_*.sql` with `CREATE TABLE "teams"`.
- Commit: `feat: add team schema + write-path service`.

### Task 2: AthleteTeamMembership schema + service (temporal)

- **Create** `src/db/schema/membership.ts` — `athleteTeamMemberships` table
  (`athlete_team_memberships`): id, athleteId fk→athletes (indexed, restrict), teamId
  fk→teams (indexed, restrict), role text nullable, startDate date, endDate date nullable,
  provenance block, timestamps; unique(athleteId, teamId, startDate). No status column.
  `Membership = $inferSelect`, `NewMembership = $inferInsert`.
- **Modify** `src/db/schema/index.ts` — add `export * from "./membership";`.
- **Create** `src/lib/memberships/service.ts`:
  - `addMembership(db, input): Promise<Membership>` — input { athleteId; teamId; role?;
    startDate; endDate?; sourceUrl?; verifiedBy?; confidence? }.
  - `endMembership(db, id, endDate): Promise<Membership>` — sets endDate; throws if no row.
  - `listMembershipsForAthlete(db, athleteId): Promise<MembershipWithTeam[]>` — join team
    name/slug; order current (null endDate) first, then startDate desc.
  - `teamRoster(db, teamId): Promise<{ current; alumni }>` — join athlete name/slug;
    current = null endDate, alumni = the rest.
- **Test** `src/db/schema/membership.test.ts` (columns present, no `status`);
  `src/lib/memberships/service.test.ts`:
  - adds a current membership (null endDate), appears in team roster `current`.
  - transfer: end old membership (stamp endDate → moves to `alumni`), add new →
    `listMembershipsForAthlete` returns both, current first.
  - rejects duplicate (athlete, team, startDate).
- Migration: `npm run db:generate` → `drizzle/0006_*.sql`, unique on
  (athlete_id, team_id, start_date), FKs without cascade.
- Commit: `feat: add athlete_team_membership schema + temporal write-path`.

### Task 3: Team + membership admin routes + validation

- **Create** `src/app/api/admin/teams/validation.ts` — `CreateTeamSchema` (name min 1,
  shortName?, sourceUrl url?, verifiedBy?, confidence enum?, status enum?).
- **Create** `src/app/api/admin/teams/route.ts` — POST (safeParse → `createTeam`, 201, 400
  on invalid) + GET `?q=` (→ `searchTeams`). Mirrors promotions route.
- **Create** `src/app/api/admin/memberships/validation.ts` — `CreateMembershipSchema`
  (athleteId uuid, teamId uuid, role?, startDate `YYYY-MM-DD` regex, endDate regex?,
  provenance optionals).
- **Create** `src/app/api/admin/memberships/route.ts` — POST (safeParse → `addMembership`,
  201, 400).
- **Test** `src/app/api/admin/teams/route.test.ts` (schema accepts valid, rejects empty
  name), `src/app/api/admin/memberships/route.test.ts` (accepts valid, rejects non-uuid
  athleteId, rejects malformed startDate).
- Commit: `feat: add team + membership admin routes`.

### Task 4: Team admin pages + forms

- **Create** `src/app/admin/teams/new/page.tsx` + `team-form.tsx` — create-team form
  (name + short name), mirrors promotion form.
- **Create** `src/app/admin/teams/[id]/page.tsx` — server component: `getTeam` + `teamRoster`,
  renders current roster and alumni lists; 404 via `notFound()` on missing team.
- **Create** `src/app/admin/teams/[id]/membership-form.tsx` — client add-member form:
  athlete typeahead over `GET /api/admin/athletes`, startDate, optional role/endDate;
  POSTs to `/api/admin/memberships`, reloads on success. Reuses the A.2 athlete-picker
  interaction shape.
- Commit: `feat: add team admin pages + membership entry form`.

### Task 5: Verify + docs + merge

- `npm test` (all green), `npx tsc --noEmit` (clean), `npm run build` (Next build passes).
- Update this plan's status note + the v1 roadmap tracking if applicable.
- Merge `phase-a3-team-membership` → `main` locally. **Do not push** — get explicit OK.
- Commit: `docs: mark Phase A.3 complete`.
