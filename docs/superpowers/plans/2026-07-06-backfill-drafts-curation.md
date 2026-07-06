# Backfill-Drafts Curation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the BJJ Heroes backfill's draft entities a path to the live public site via an `/admin/drafts` dashboard that bulk-publishes the clean majority (cascading match → event → promotion → both athletes) and surfaces the un-publishable outliers read-only.

**Architecture:** Two pure-ish service units under `src/lib/curation/` — a read model (`queries.ts`) and a transactional publisher (`publish.ts`) — behind a thin validated `POST /api/admin/publish` route, rendered by an `/admin/drafts` server page with a small client component for the publish buttons. No schema change; publishing only flips the existing `status` column `draft → published`.

**Tech Stack:** TypeScript (ESM, strict), Next.js App Router, Drizzle ORM + Postgres (pglite in tests), `zod`, `vitest`. Path alias `@/` → `src/`.

## Global Constraints

- TypeScript strict mode with `noUncheckedIndexedAccess` — array/tuple access is `T | undefined`; guard every index.
- **Publishable vs blocked (the core rule):** a draft match is **blocked** iff any competitor athlete is a non-identity — `trim(full_name) = ''` or `lower(trim(full_name)) = 'unknown'`. Otherwise **publishable**. `format = "unknown"` is a soft flag, never a blocker.
- **Publish cascade:** publishing a match flips `status` to `"published"` on the match, its event, the event's promotion, and both competitor athletes, in one `db.transaction`. Idempotent (already-published rows are untouched and counted as 0). Blocked matches are skipped, never errored.
- **No schema change, no editing, no reject/delete** in this feature.
- Reuse the non-identity predicate and the blocked/publishable id helpers from `queries.ts` in `publish.ts` — do not duplicate the rule.
- Tests use in-process pglite via `createTestDb()` from `@/db/test-db` (runs real `./drizzle` migrations). Seed with existing services (`createAthlete`, `createPromotion`, `createEvent`, `createMatch`).
- Run the full suite with `npm test`; type-check with `npx tsc --noEmit`.
- `Db` type is imported from `@/db/client`. Drizzle helpers (`and`, `eq`, `inArray`, `count`, `sql`) from `drizzle-orm`.

---

### Task 1: Curation read model (`queries.ts`)

The dashboard's data source and the single home of the blocked/publishable rule.

**Files:**
- Create: `src/lib/curation/queries.ts`
- Test: `src/lib/curation/queries.test.ts`

**Interfaces:**
- Consumes: `matches`, `matchCompetitors` from `@/db/schema/match`; `athletes` from `@/db/schema/athlete`; `events` from `@/db/schema/event`; `promotions` from `@/db/schema/promotion`; `Db` from `@/db/client`.
- Produces:
```ts
export type DraftDashboard = {
  draftAthletes: number; draftPromotions: number; draftEvents: number;
  publishableMatches: number; blockedMatches: number; softFlaggedMatches: number;
};
export type BlockedMatch = { matchId: string; eventName: string; reason: string };
export type DraftAthleteSummary = {
  athleteId: string; fullName: string; slug: string; publishableMatches: number;
};
export function blockedMatchIds(db: Db): Promise<string[]>;
export function publishableMatchIds(db: Db): Promise<string[]>;
export function draftDashboard(db: Db): Promise<DraftDashboard>;
export function blockedMatches(db: Db, limit?: number): Promise<BlockedMatch[]>;
export function draftAthleteSummaries(db: Db, limit?: number): Promise<DraftAthleteSummary[]>;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/curation/queries.test.ts`:

```ts
import { it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import {
  draftDashboard, blockedMatchIds, publishableMatchIds,
  blockedMatches, draftAthleteSummaries,
} from "./queries";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

// A draft event + promotion to hang matches on.
async function seedEvent() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  return createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
}

it("classifies a clean draft match as publishable and counts drafts", async () => {
  const { db } = ctx;
  const ev = await seedEvent();
  const a = await createAthlete(db, { fullName: "Gordon Ryan" });
  const b = await createAthlete(db, { fullName: "Felipe Pena" });
  await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "SUBMISSION", format: "nogi",
    competitors: [
      { athleteId: a.id, outcome: "WON", slotOrder: 1 },
      { athleteId: b.id, outcome: "LOST", slotOrder: 2 },
    ],
  });

  expect((await publishableMatchIds(db)).length).toBe(1);
  expect((await blockedMatchIds(db)).length).toBe(0);

  const d = await draftDashboard(db);
  expect(d.draftAthletes).toBe(2);
  expect(d.draftPromotions).toBe(1);
  expect(d.draftEvents).toBe(1);
  expect(d.publishableMatches).toBe(1);
  expect(d.blockedMatches).toBe(0);
  expect(d.softFlaggedMatches).toBe(0); // format is nogi
});

it("blocks a match with an 'Unknown' opponent and soft-flags format=unknown", async () => {
  const { db } = ctx;
  const ev = await seedEvent();
  const real = await createAthlete(db, { fullName: "Gordon Ryan" });
  const unknown = await createAthlete(db, { fullName: "Unknown" });
  const other = await createAthlete(db, { fullName: "Andre Galvao" });

  // Blocked: competitor named "Unknown".
  await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "POINTS", format: "nogi",
    competitors: [
      { athleteId: real.id, outcome: "WON", slotOrder: 1 },
      { athleteId: unknown.id, outcome: "LOST", slotOrder: 2 },
    ],
  });
  // Publishable but soft-flagged: format unknown, both real names.
  await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "POINTS", format: "unknown",
    competitors: [
      { athleteId: real.id, outcome: "WON", slotOrder: 1 },
      { athleteId: other.id, outcome: "LOST", slotOrder: 2 },
    ],
  });

  const d = await draftDashboard(db);
  expect(d.blockedMatches).toBe(1);
  expect(d.publishableMatches).toBe(1);
  expect(d.softFlaggedMatches).toBe(1);

  const blocked = await blockedMatches(db);
  expect(blocked).toHaveLength(1);
  expect(blocked[0]!.reason.toLowerCase()).toContain("unknown");

  const summaries = await draftAthleteSummaries(db);
  const gordon = summaries.find((s) => s.fullName === "Gordon Ryan")!;
  expect(gordon.publishableMatches).toBe(1); // only the non-blocked match counts
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curation/queries.test.ts`
Expected: FAIL — `Cannot find module './queries'`.

- [ ] **Step 3: Implement `queries.ts`**

Create `src/lib/curation/queries.ts`:

```ts
import { and, eq, inArray, count, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors } from "@/db/schema/match";
import { athletes } from "@/db/schema/athlete";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";

export type DraftDashboard = {
  draftAthletes: number; draftPromotions: number; draftEvents: number;
  publishableMatches: number; blockedMatches: number; softFlaggedMatches: number;
};
export type BlockedMatch = { matchId: string; eventName: string; reason: string };
export type DraftAthleteSummary = {
  athleteId: string; fullName: string; slug: string; publishableMatches: number;
};

// The one home of the blocked-identity rule: a junk/unnamed opponent row.
const NON_IDENTITY = sql`(trim(${athletes.fullName}) = '' or lower(trim(${athletes.fullName})) = 'unknown')`;

async function tableCount(db: Db, table: typeof athletes | typeof events | typeof promotions): Promise<number> {
  const rows = await db.select({ n: count() }).from(table).where(eq(table.status, "draft"));
  return rows[0]?.n ?? 0;
}

// Draft matches that have at least one non-identity competitor.
export async function blockedMatchIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: matches.id })
    .from(matches)
    .innerJoin(matchCompetitors, eq(matchCompetitors.matchId, matches.id))
    .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
    .where(and(eq(matches.status, "draft"), NON_IDENTITY));
  return rows.map((r) => r.id);
}

// Draft matches that are NOT blocked.
export async function publishableMatchIds(db: Db): Promise<string[]> {
  const blocked = new Set(await blockedMatchIds(db));
  const rows = await db.select({ id: matches.id }).from(matches).where(eq(matches.status, "draft"));
  return rows.map((r) => r.id).filter((id) => !blocked.has(id));
}

export async function draftDashboard(db: Db): Promise<DraftDashboard> {
  const draftMatchRows = await db
    .select({ id: matches.id, format: matches.format })
    .from(matches)
    .where(eq(matches.status, "draft"));
  const blocked = new Set(await blockedMatchIds(db));

  let publishableMatches = 0, blockedMatches = 0, softFlaggedMatches = 0;
  for (const m of draftMatchRows) {
    if (blocked.has(m.id)) { blockedMatches += 1; continue; }
    publishableMatches += 1;
    if (m.format === "unknown") softFlaggedMatches += 1;
  }

  return {
    draftAthletes: await tableCount(db, athletes),
    draftPromotions: await tableCount(db, promotions),
    draftEvents: await tableCount(db, events),
    publishableMatches, blockedMatches, softFlaggedMatches,
  };
}

export async function blockedMatches(db: Db, limit = 100): Promise<BlockedMatch[]> {
  const rows = await db
    .selectDistinct({
      matchId: matches.id,
      eventName: events.name,
      offenderName: athletes.fullName,
    })
    .from(matches)
    .innerJoin(matchCompetitors, eq(matchCompetitors.matchId, matches.id))
    .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
    .innerJoin(events, eq(matches.eventId, events.id))
    .where(and(eq(matches.status, "draft"), NON_IDENTITY))
    .limit(limit);
  return rows.map((r) => ({
    matchId: r.matchId,
    eventName: r.eventName,
    reason: `opponent '${r.offenderName || "(empty)"}'`,
  }));
}

export async function draftAthleteSummaries(db: Db, limit = 200): Promise<DraftAthleteSummary[]> {
  const publishable = await publishableMatchIds(db);
  const byAthlete = new Map<string, number>();
  if (publishable.length) {
    const comps = await db
      .select({ athleteId: matchCompetitors.athleteId, matchId: matchCompetitors.matchId })
      .from(matchCompetitors)
      .where(inArray(matchCompetitors.matchId, publishable));
    for (const c of comps) byAthlete.set(c.athleteId, (byAthlete.get(c.athleteId) ?? 0) + 1);
  }

  const draftAthletes = await db
    .select({ id: athletes.id, fullName: athletes.fullName, slug: athletes.slug })
    .from(athletes)
    .where(eq(athletes.status, "draft"));

  return draftAthletes
    .map((a) => ({
      athleteId: a.id, fullName: a.fullName, slug: a.slug,
      publishableMatches: byAthlete.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.publishableMatches - a.publishableMatches)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curation/queries.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/curation/queries.ts src/lib/curation/queries.test.ts
git commit -m "feat(curation): draft dashboard read model + blocked/publishable rule"
```

---

### Task 2: Publish service (`publish.ts`)

Transactional cascade publisher. Reuses the id helpers from Task 1.

**Files:**
- Create: `src/lib/curation/publish.ts`
- Test: `src/lib/curation/publish.test.ts`

**Interfaces:**
- Consumes: `blockedMatchIds`, `publishableMatchIds` from `./queries`; `matches`, `matchCompetitors` from `@/db/schema/match`; `events`, `promotions`, `athletes` schemas; `Db` from `@/db/client`.
- Produces:
```ts
export type PublishResult = {
  matches: number; events: number; promotions: number; athletes: number; skippedBlocked: number;
};
export function publishMatches(db: Db, matchIds: string[]): Promise<PublishResult>;
export function publishAllPublishable(db: Db): Promise<PublishResult>;
export function publishAthleteGraph(db: Db, athleteId: string): Promise<PublishResult>;
```

**Semantics:**
- `publishMatches`: keep only ids that are publishable draft matches (drop blocked/already-published/unknown); `skippedBlocked` = how many passed ids were blocked draft matches; cascade-publish the graph; each count is rows actually flipped `draft → published`.
- `publishAllPublishable`: `publishMatches(db, await publishableMatchIds(db))`.
- `publishAthleteGraph`: publish the athlete's publishable draft matches (cascade) and always ensure the athlete row itself is published, even with zero publishable matches; `skippedBlocked` = that athlete's blocked draft-match count.

- [ ] **Step 1: Write the failing test**

Create `src/lib/curation/publish.test.ts`:

```ts
import { it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { matches } from "@/db/schema/match";
import { athletes } from "@/db/schema/athlete";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { publishMatches, publishAllPublishable, publishAthleteGraph } from "./publish";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedGraph(format: "nogi" | "unknown", oppName: string) {
  const { db } = ctx;
  const p = await createPromotion(db, { name: "ADCC" });
  const ev = await createEvent(db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
  const a = await createAthlete(db, { fullName: "Gordon Ryan" });
  const b = await createAthlete(db, { fullName: oppName });
  const m = await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "SUBMISSION", format,
    competitors: [
      { athleteId: a.id, outcome: "WON", slotOrder: 1 },
      { athleteId: b.id, outcome: "LOST", slotOrder: 2 },
    ],
  });
  return { promotionId: p.id, eventId: ev.id, aId: a.id, bId: b.id, matchId: m.id };
}

it("publishes a clean match and cascades to event, promotion, and both athletes", async () => {
  const { db } = ctx;
  const g = await seedGraph("nogi", "Felipe Pena");

  const r = await publishMatches(db, [g.matchId]);
  expect(r).toEqual({ matches: 1, events: 1, promotions: 1, athletes: 2, skippedBlocked: 0 });

  const status = async (t: any, id: string) => (await db.select().from(t).where(eq(t.id, id)))[0]?.status;
  expect(await status(matches, g.matchId)).toBe("published");
  expect(await status(events, g.eventId)).toBe("published");
  expect(await status(promotions, g.promotionId)).toBe("published");
  expect(await status(athletes, g.aId)).toBe("published");
  expect(await status(athletes, g.bId)).toBe("published");
});

it("is idempotent — re-publishing flips nothing", async () => {
  const { db } = ctx;
  const g = await seedGraph("nogi", "Felipe Pena");
  await publishMatches(db, [g.matchId]);
  const second = await publishMatches(db, [g.matchId]);
  expect(second).toEqual({ matches: 0, events: 0, promotions: 0, athletes: 0, skippedBlocked: 0 });
});

it("skips a blocked (Unknown-opponent) match, publishing nothing", async () => {
  const { db } = ctx;
  const g = await seedGraph("nogi", "Unknown");
  const r = await publishMatches(db, [g.matchId]);
  expect(r.matches).toBe(0);
  expect(r.skippedBlocked).toBe(1);
  const row = (await db.select().from(matches).where(eq(matches.id, g.matchId)))[0];
  expect(row?.status).toBe("draft");
});

it("publishAllPublishable publishes clean and leaves blocked as draft", async () => {
  const { db } = ctx;
  await seedGraph("nogi", "Felipe Pena"); // publishable
  await seedGraph("unknown", "Unknown");  // blocked
  const r = await publishAllPublishable(db);
  expect(r.matches).toBe(1);
  const remainingDrafts = (await db.select().from(matches).where(eq(matches.status, "draft"))).length;
  expect(remainingDrafts).toBe(1); // the blocked one
});

it("publishAthleteGraph publishes the athlete + their publishable matches and skips blocked", async () => {
  const { db } = ctx;
  const clean = await seedGraph("nogi", "Felipe Pena");
  // Give the same subject a second, blocked match against 'Unknown'.
  const unknown = await createAthlete(db, { fullName: "Unknown" });
  await createMatch(db, {
    eventId: clean.eventId, matchType: "SUPERFIGHT", method: "POINTS", format: "nogi",
    competitors: [
      { athleteId: clean.aId, outcome: "WON", slotOrder: 1 },
      { athleteId: unknown.id, outcome: "LOST", slotOrder: 2 },
    ],
  });

  const r = await publishAthleteGraph(db, clean.aId);
  expect(r.matches).toBe(1);
  expect(r.skippedBlocked).toBe(1);
  const subj = (await db.select().from(athletes).where(eq(athletes.id, clean.aId)))[0];
  expect(subj?.status).toBe("published");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curation/publish.test.ts`
Expected: FAIL — `Cannot find module './publish'`.

- [ ] **Step 3: Implement `publish.ts`**

Create `src/lib/curation/publish.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors } from "@/db/schema/match";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { athletes } from "@/db/schema/athlete";
import { blockedMatchIds, publishableMatchIds } from "./queries";

export type PublishResult = {
  matches: number; events: number; promotions: number; athletes: number; skippedBlocked: number;
};

const EMPTY: PublishResult = { matches: 0, events: 0, promotions: 0, athletes: 0, skippedBlocked: 0 };

// Flip draft -> published for the given ids on one table; return rows actually changed.
async function flip(
  tx: Db,
  table: typeof matches | typeof events | typeof promotions | typeof athletes,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const changed = await tx
    .update(table)
    .set({ status: "published" })
    .where(and(inArray(table.id, ids), eq(table.status, "draft")))
    .returning({ id: table.id });
  return changed.length;
}

// Cascade-publish a set of already-vetted publishable match ids, plus optionally
// force-publish a subject athlete (used by publishAthleteGraph for the 0-match case).
async function cascade(
  db: Db, targetMatchIds: string[], skippedBlocked: number, forceAthleteId?: string,
): Promise<PublishResult> {
  if (!targetMatchIds.length && !forceAthleteId) return { ...EMPTY, skippedBlocked };

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db; // tx is structurally compatible with Db (see commitBatch)

    const eventIds = targetMatchIds.length
      ? [...new Set((await tx
          .select({ id: matches.eventId }).from(matches)
          .where(inArray(matches.id, targetMatchIds))).map((r) => r.id))]
      : [];
    const promotionIds = eventIds.length
      ? [...new Set((await tx
          .select({ id: events.promotionId }).from(events)
          .where(inArray(events.id, eventIds))).map((r) => r.id))]
      : [];
    const athleteIdSet = new Set<string>();
    if (targetMatchIds.length) {
      const comps = await tx
        .select({ id: matchCompetitors.athleteId }).from(matchCompetitors)
        .where(inArray(matchCompetitors.matchId, targetMatchIds));
      for (const c of comps) athleteIdSet.add(c.id);
    }
    if (forceAthleteId) athleteIdSet.add(forceAthleteId);

    return {
      matches: await flip(tx, matches, targetMatchIds),
      events: await flip(tx, events, eventIds),
      promotions: await flip(tx, promotions, promotionIds),
      athletes: await flip(tx, athletes, [...athleteIdSet]),
      skippedBlocked,
    };
  });
}

export async function publishMatches(db: Db, matchIds: string[]): Promise<PublishResult> {
  if (!matchIds.length) return { ...EMPTY };
  const publishable = new Set(await publishableMatchIds(db));
  const blocked = new Set(await blockedMatchIds(db));
  const target = matchIds.filter((id) => publishable.has(id));
  const skippedBlocked = matchIds.filter((id) => blocked.has(id)).length;
  return cascade(db, target, skippedBlocked);
}

export async function publishAllPublishable(db: Db): Promise<PublishResult> {
  return cascade(db, await publishableMatchIds(db), 0);
}

export async function publishAthleteGraph(db: Db, athleteId: string): Promise<PublishResult> {
  const publishable = new Set(await publishableMatchIds(db));
  const blocked = new Set(await blockedMatchIds(db));
  const compRows = await db
    .select({ matchId: matchCompetitors.matchId })
    .from(matchCompetitors)
    .where(eq(matchCompetitors.athleteId, athleteId));
  const theirMatchIds = [...new Set(compRows.map((r) => r.matchId))];
  const target = theirMatchIds.filter((id) => publishable.has(id));
  const skippedBlocked = theirMatchIds.filter((id) => blocked.has(id)).length;
  return cascade(db, target, skippedBlocked, athleteId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curation/publish.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`, then:

```bash
git add src/lib/curation/publish.ts src/lib/curation/publish.test.ts
git commit -m "feat(curation): transactional cascade publisher for draft entities"
```

---

### Task 3: Publish API route + validation

Thin HTTP wrapper over the publish service, matching the existing admin route + zod convention.

**Files:**
- Create: `src/app/api/admin/publish/validation.ts`
- Create: `src/app/api/admin/publish/route.ts`
- Test: `src/app/api/admin/publish/validation.test.ts`

**Interfaces:**
- Consumes: `publishAllPublishable`, `publishAthleteGraph` from `@/lib/curation/publish`; `db` from `@/db/client`.
- Produces: `PublishRequestSchema` (zod) and a `POST` handler returning `PublishResult` (200) / `{ error }` (400/500).

- [ ] **Step 1: Write the failing validation test**

Create `src/app/api/admin/publish/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PublishRequestSchema } from "@/app/api/admin/publish/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("PublishRequestSchema", () => {
  it("accepts scope=all", () => {
    expect(PublishRequestSchema.parse({ scope: "all" }).scope).toBe("all");
  });
  it("accepts scope=athlete with a uuid", () => {
    const p = PublishRequestSchema.parse({ scope: "athlete", athleteId: uuid });
    expect(p).toEqual({ scope: "athlete", athleteId: uuid });
  });
  it("rejects scope=athlete without an athleteId", () => {
    expect(() => PublishRequestSchema.parse({ scope: "athlete" })).toThrow();
  });
  it("rejects an unknown scope", () => {
    expect(() => PublishRequestSchema.parse({ scope: "everything" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/admin/publish/validation.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/publish/validation'`.

- [ ] **Step 3: Implement `validation.ts`**

Create `src/app/api/admin/publish/validation.ts`:

```ts
import { z } from "zod";

export const PublishRequestSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("athlete"), athleteId: z.string().uuid() }),
]);

export type PublishRequest = z.infer<typeof PublishRequestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/admin/publish/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the route**

Create `src/app/api/admin/publish/route.ts` (mirrors `src/app/api/admin/matches/route.ts`):

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { publishAllPublishable, publishAthleteGraph } from "@/lib/curation/publish";
import { PublishRequestSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = PublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = parsed.data.scope === "all"
      ? await publishAllPublishable(db)
      : await publishAthleteGraph(db, parsed.data.athleteId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`, then:

```bash
git add src/app/api/admin/publish/
git commit -m "feat(curation): POST /api/admin/publish route with zod validation"
```

---

### Task 4: `/admin/drafts` dashboard page + client actions

The visible surface: counts, per-athlete publish, bulk publish, read-only blocked list.

**Files:**
- Create: `src/app/admin/drafts/page.tsx`
- Create: `src/app/admin/drafts/publish-actions.tsx`
- Test: none (server page + client wiring; verified manually per the spec)

**Interfaces:**
- Consumes: `draftDashboard`, `draftAthleteSummaries`, `blockedMatches` from `@/lib/curation/queries`; `db` from `@/db/client`; the `POST /api/admin/publish` route from Task 3.
- Produces: the `/admin/drafts` page.

- [ ] **Step 1: Implement the client actions component**

Create `src/app/admin/drafts/publish-actions.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Summary = { athleteId: string; fullName: string; slug: string; publishableMatches: number };

async function post(body: unknown): Promise<string> {
  const res = await fetch("/api/admin/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return `Failed: ${JSON.stringify(data.error)}`;
  return `Published ${data.matches} matches, ${data.events} events, ${data.promotions} promotions, ${data.athletes} athletes (skipped ${data.skippedBlocked} blocked).`;
}

export function PublishActions(
  { publishableMatches, summaries }: { publishableMatches: number; summaries: Summary[] },
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(body: unknown) {
    setBusy(true);
    setMessage(await post(body));
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button disabled={busy || publishableMatches === 0} onClick={() => run({ scope: "all" })}>
        Publish all {publishableMatches} publishable matches
      </button>
      {message && <p>{message}</p>}
      <h2>Draft athletes</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th align="left">Athlete</th><th align="left">Publishable matches</th><th /></tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.athleteId} style={{ borderTop: "1px solid #ddd" }}>
              <td>{s.fullName}</td>
              <td>{s.publishableMatches}</td>
              <td>
                <button
                  disabled={busy}
                  onClick={() => run({ scope: "athlete", athleteId: s.athleteId })}
                >
                  Publish graph
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Implement the server page**

Create `src/app/admin/drafts/page.tsx` (mirrors `src/app/admin/ingest/[id]/page.tsx` layout):

```tsx
import { db } from "@/db/client";
import { draftDashboard, draftAthleteSummaries, blockedMatches } from "@/lib/curation/queries";
import { PublishActions } from "./publish-actions";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const [dashboard, summaries, blocked] = await Promise.all([
    draftDashboard(db),
    draftAthleteSummaries(db),
    blockedMatches(db),
  ]);

  return (
    <main style={{ maxWidth: 860, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Backfill drafts</h1>
      <p>
        {dashboard.draftAthletes} draft athletes · {dashboard.draftEvents} events ·{" "}
        {dashboard.draftPromotions} promotions · {dashboard.publishableMatches} publishable
        matches ({dashboard.softFlaggedMatches} need a format tag) ·{" "}
        {dashboard.blockedMatches} blocked.
      </p>

      <PublishActions
        publishableMatches={dashboard.publishableMatches}
        summaries={summaries}
      />

      <h2>Blocked (needs a real opponent — left as draft)</h2>
      {blocked.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {blocked.map((b) => (
            <li key={b.matchId}>{b.eventName} — {b.reason}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification against the docker DB**

The local docker DB already holds backfill drafts (from the smoke run). Start the app and exercise the flow:

```bash
docker compose up -d
npm run dev
```

- Open `http://localhost:3000/admin/drafts`. Confirm the counts line shows non-zero draft athletes and publishable matches, and the blocked list shows the `'Unknown'` opponent entries.
- Click **Publish graph** on one athlete (e.g. the top row). Confirm the success message reports published matches/athletes and the page refreshes with reduced counts.
- Open that athlete's public page `http://localhost:3000/athlete/<slug>` (use the slug from the row) and confirm their record now renders.
- Optionally click **Publish all publishable** and confirm remaining publishable count drops to 0 while the blocked count is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/drafts/
git commit -m "feat(curation): /admin/drafts dashboard with bulk + per-athlete publish"
```

---

### Task 5: Full-suite gate

- [ ] **Step 1: Run the whole suite and type-check**

Run: `npm test` (all pass) and `npx tsc --noEmit` (clean).
Expected: green. If anything regressed, fix before finishing.

---

## Self-Review

**Spec coverage:**
- Publishable-vs-blocked rule (Unknown/empty blocks; format=unknown soft flag) → Task 1 `NON_IDENTITY` + `draftDashboard`. ✅
- Transactional cascade publish (match→event→promotion→both athletes), idempotent, skip-blocked → Task 2 `cascade`/`flip`. ✅
- Read model for dashboard (counts, blocked list, per-athlete summaries) → Task 1. ✅
- `POST /api/admin/publish` with `{scope:"all"|"athlete"}` validation → Task 3. ✅
- `/admin/drafts` server page + client publish buttons + read-only blocked section → Task 4. ✅
- No schema change, publish-only, no editing/reject → nothing in any task alters schema or deletes rows. ✅
- TDD with pglite `createTestDb` → Tasks 1–3 tests. ✅
- Known limitation (no auth) → intentionally not addressed, consistent with existing open admin routes. ✅

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Task 4 has no unit test by design (page/client wiring) with concrete manual steps instead.

**Type consistency:** `PublishResult` shape identical in Task 2 definition, tests, route (Task 3), and client message (Task 4). `blockedMatchIds`/`publishableMatchIds` defined in Task 1, imported unchanged in Task 2. `DraftAthleteSummary` fields (`athleteId`, `fullName`, `slug`, `publishableMatches`) match the client `Summary` type in Task 4. `PublishRequestSchema` discriminated union (`scope`) matches the route dispatch and the client bodies (`{scope:"all"}`, `{scope:"athlete",athleteId}`). The `flip` helper's `table.id`/`table.status` columns exist on all four tables (matches/events/promotions/athletes all have `id` + `status`).

**Note for the implementer:** Task 1 must precede Task 2 (shared id helpers) and Task 4 (dashboard queries). Task 2 precedes Task 3 (route calls the service). Task 3 precedes Task 4 (buttons call the route). Do them in order.
