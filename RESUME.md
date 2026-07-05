# RollVault — Session Resume / Handoff

**Purpose:** Pick up work here in any fresh session. Everything needed is in git + memory.

## Where things are

- **v1 design spec:** `docs/superpowers/specs/2026-07-03-rollvault-v1-design.md`
- **Phase A.1 plan:** `docs/superpowers/plans/2026-07-03-rollvault-phase-a1-athlete-core.md`
- **Phase A.2 spec:** `docs/superpowers/specs/2026-07-04-rollvault-phase-a2-competition-core-design.md`
- **Phase A.2 plan:** `docs/superpowers/plans/2026-07-04-rollvault-phase-a2-competition-core.md`
- **Auto-memory:** `rollvault-project.md` in the Claude memory dir (indexed in MEMORY.md)

## What we're building (one line)

RollVault — no-gi elite grappling records database. Editorial-first, Next.js + Postgres +
Drizzle. Phase A builds the data core + admin write-path before any public pages/automation.

## Progress log

- [x] **Phase A.1 — Athlete identity core.** Merged to `master` (merge `974094f`).
      Athlete + AthleteAlias schema, name-normalization/duplicate scoring, pglite test
      harness, typed write-path, admin entry UI with duplicate gate.
- [x] **Phase A.2 — Competition core.** Merged to `master` (merge `e26edb9`, 2026-07-04).
      Promotion / Event / Match / MatchCompetitor / Placement schema + typed write-path
      services (transactional `createMatch`, derived `athleteRecord`), event-centric admin
      entry flow. Executed inline (6 tasks, TDD, commit per task); feature branch deleted.

## Current state (Phase A.2 complete + merged + pushed)

- Single canonical branch **`main`**, HEAD `029e039`, **pushed to `origin/main`**. Working
  tree clean. Local `master` and the old feature branches were consolidated into `main`;
  redundant `origin/master` and stale `origin/phase-a1-athlete-core` were deleted. `origin`
  now has exactly one branch: `main`.
- **51/51 tests pass; `tsc --noEmit` clean; `next build` succeeds** on the merged result.
- Build note: route Zod schemas live in sibling `validation.ts` files (not exported from
  `route.ts`) — Next 15 App Router forbids non-handler route exports. Follow this pattern
  for any new admin route.

## To resume (Phase A.2 done — next is a new phase)

1. Read this file + the v1 design spec.
2. Work on `main` (or a feature branch off it); it's the single source of truth, local + remote.
3. Start the next phase, beginning with superpowers:brainstorming. Candidates per the v1
   spec §7 roadmap: **Phase A.3** (Team + temporal AthleteTeamMembership; `change_log`
   audit + created_by/updated_by; edit/update paths) or **Phase B** (public server-rendered
   pages + Postgres FTS search + video/instructional secondary layer).

## Not-yet-done / open items

- **Manual UI browser check never run** (both phases) — needs a live DATABASE_URL
  (`npm run db:migrate` + `npm run dev`; visit `/admin/promotions/new` → `/admin/events/new`
  → `/admin/events/[id]`). Automated `next build` passes as a proxy, but no live DB round-trip.
- **Inherited/deferred (tracked in A.2 plan's "Inherited / deferred follow-ups"):**
  server-enforced duplicate gate (currently UI-only), admin auth on `/admin/*`, route-handler
  integration tests (only Zod schemas tested), `updatedAt` auto-bump, and hardening
  `weight_class`/`ruleset` into lookup tables once real data spread is visible.

_Last updated: 2026-07-04, Phase A.2 merged + consolidated onto `main` and pushed to origin; ready for next phase._
