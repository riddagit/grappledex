# RollVault Phase A.2 — Competition Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the competition core — Promotion, Event, Match, MatchCompetitor, and Placement — as typed, tested schema + write-path services plus an event-centric admin entry flow, reusing the entity-resolution, provenance, and draft/publish patterns proven in Phase A.1.

**Architecture:** Same stack and shape as A.1. Postgres is the source of truth via Drizzle; all writes go through typed `Db`-taking service functions, never direct DB access from UI. Match creation is transactional (match row + its competitor rows commit or roll back together). Tests run hermetically against in-process pglite using the existing `createTestDb` harness. The admin flow is event-centric: create promotion → create event → an event hub adds matches (athlete typeahead reusing A.1's search + duplicate gate) and placements.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Drizzle ORM, `postgres` (postgres-js) runtime driver, `@electric-sql/pglite` for tests, Vitest, Zod for input validation. All already installed from A.1.

## Global Constraints

- Runtime source of truth is **Postgres**; no other database. (spec §1)
- Every entity has a **UUID primary key**; public entities (promotion, event) also get a human **`slug`**. Matches/competitors/placements are child records, addressed via their parent — no slug. (design §2)
- Every promotion/event/match/placement fact carries the **provenance block**: `sourceUrl`, `verifiedBy`, `verifiedAt`, `confidence` (`CONFIRMED` | `NEEDS_REVIEW`, default `NEEDS_REVIEW`). (design §2)
- Promotion/event/match have **`draft` → `published`** `status` (default `draft`). Placements inherit their event's publication state and have **no** independent status. (design §2)
- `match_type`, `outcome`, and `method` are **closed enums** (`text` column with a Drizzle `enum` option, matching A.1's `status`/`confidence` style — no `pgEnum`). `weight_class` and `ruleset` are **free-text** (curated in the UI, not enums). (design §3)
- Writes go through the **typed service layer**, not direct DB pokes from UI/route handlers. (spec §5)
- Match creation is **atomic**: the match row and all its `match_competitors` rows are inserted in one transaction. (design §4)
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. (this plan)
- Enum value sets (copy verbatim):
  - `match_type`: `BRACKET` | `SUPERFIGHT` | `TRIAL` | `ALTERNATE`
  - `outcome`: `WON` | `LOST` | `DRAW` | `NC` | `DQ`
  - `method`: `SUBMISSION` | `POINTS` | `DECISION` | `DQ` | `OVERTIME` | `FORFEIT` | `NC` | `DRAW`

---

### Task 1: Promotion schema + write-path service

**Files:**
- Create: `src/db/schema/promotion.ts`
- Modify: `src/db/schema/index.ts` (add `export * from "./promotion";`)
- Create: `src/lib/promotions/service.ts`
- Test: `src/db/schema/promotion.test.ts`
- Test: `src/lib/promotions/service.test.ts`

**Interfaces:**
- Consumes: `Db` (`src/db/client.ts`), `slugify` (`src/lib/identity/normalize.ts`), `createTestDb` (`src/db/test-db.ts`).
- Produces:
  - `promotions` table: `id` (uuid pk), `slug` (text unique), `name` (text), `shortName` (text nullable), provenance block, `status` (`'draft'|'published'` default `'draft'`), `createdAt`, `updatedAt`.
  - `Promotion = typeof promotions.$inferSelect`, `NewPromotion = typeof promotions.$inferInsert`.
  - `type CreatePromotionInput = { name: string; shortName?: string; sourceUrl?: string; verifiedBy?: string; confidence?: "CONFIRMED" | "NEEDS_REVIEW"; status?: "draft" | "published" }`
  - `createPromotion(db: Db, input: CreatePromotionInput): Promise<Promotion>` — derives a unique slug from `name` (suffix `-2`, `-3`… on collision), stamps `verifiedAt` when `verifiedBy` set.
  - `searchPromotions(db: Db, query: string): Promise<{ id: string; name: string; slug: string }[]>`

- [ ] **Step 1: Write the failing schema test**

`src/db/schema/promotion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { promotions } from "@/db/schema/promotion";

describe("promotion schema", () => {
  it("defines identity, provenance, and status columns", () => {
    const cols = Object.keys(getTableColumns(promotions));
    for (const c of [
      "id", "slug", "name", "shortName", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/db/schema/promotion.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/promotion`.

- [ ] **Step 3: Write the schema**

`src/db/schema/promotion.ts`:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const promotions = pgTable("promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  sourceUrl: text("source_url"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  confidence: text("confidence", { enum: ["CONFIRMED", "NEEDS_REVIEW"] })
    .notNull()
    .default("NEEDS_REVIEW"),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
```

Append to `src/db/schema/index.ts`:

```ts
export * from "./promotion";
```

- [ ] **Step 4: Run to verify the schema test passes**

Run: `npm test src/db/schema/promotion.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0001_*.sql` containing `CREATE TABLE "promotions"`. Open it and confirm.

- [ ] **Step 6: Write the failing service test**

`src/lib/promotions/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createPromotion, searchPromotions } from "@/lib/promotions/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("createPromotion", () => {
  it("creates a promotion with a derived slug and stamps verification", async () => {
    const p = await createPromotion(ctx.db, {
      name: "Abu Dhabi Combat Club",
      shortName: "ADCC",
      verifiedBy: "editor@rollvault",
      confidence: "CONFIRMED",
    });
    expect(p.slug).toBe("abu-dhabi-combat-club");
    expect(p.shortName).toBe("ADCC");
    expect(p.confidence).toBe("CONFIRMED");
    expect(p.verifiedAt).not.toBeNull();
    expect(p.status).toBe("draft");
  });

  it("disambiguates slug collisions", async () => {
    const a = await createPromotion(ctx.db, { name: "Polaris" });
    const b = await createPromotion(ctx.db, { name: "Polaris" });
    expect(a.slug).toBe("polaris");
    expect(b.slug).toBe("polaris-2");
  });
});

describe("searchPromotions", () => {
  it("finds by case-insensitive substring", async () => {
    await createPromotion(ctx.db, { name: "Who's Number One", shortName: "WNO" });
    const rows = await searchPromotions(ctx.db, "number");
    expect(rows[0]?.name).toBe("Who's Number One");
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test src/lib/promotions/service.test.ts`
Expected: FAIL — cannot resolve `@/lib/promotions/service`.

- [ ] **Step 8: Implement the service**

`src/lib/promotions/service.ts`:

```ts
import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { promotions, type Promotion } from "@/db/schema/promotion";
import { slugify } from "@/lib/identity/normalize";

export type CreatePromotionInput = {
  name: string;
  shortName?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || "promotion";
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await db
      .select({ id: promotions.id })
      .from(promotions)
      .where(eq(promotions.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function createPromotion(
  db: Db,
  input: CreatePromotionInput,
): Promise<Promotion> {
  const slug = await uniqueSlug(db, input.name);
  const rows = await db
    .insert(promotions)
    .values({
      slug,
      name: input.name,
      shortName: input.shortName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
      status: input.status ?? "draft",
    })
    .returning();
  const promotion = rows[0];
  if (!promotion) throw new Error("createPromotion: insert returned no rows");
  return promotion;
}

export async function searchPromotions(
  db: Db,
  query: string,
): Promise<{ id: string; name: string; slug: string }[]> {
  return db
    .select({ id: promotions.id, name: promotions.name, slug: promotions.slug })
    .from(promotions)
    .where(ilike(promotions.name, `%${query}%`))
    .limit(10);
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm test src/lib/promotions/service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add promotion schema + write-path service"
```

---

### Task 2: Event schema + write-path service

**Files:**
- Create: `src/db/schema/event.ts`
- Modify: `src/db/schema/index.ts` (add `export * from "./event";`)
- Create: `src/lib/events/service.ts`
- Test: `src/db/schema/event.test.ts`
- Test: `src/lib/events/service.test.ts`

**Interfaces:**
- Consumes: `Db`, `slugify`, `createTestDb`, `promotions`/`createPromotion` (Task 1).
- Produces:
  - `events` table: `id` (uuid pk), `slug` (text unique), `promotionId` (uuid fk → promotions.id), `name` (text), `startDate` (date), `endDate` (date nullable), `venue` (text nullable), `location` (text nullable), provenance block, `status` (`'draft'|'published'` default `'draft'`), `createdAt`, `updatedAt`. Index on `promotionId`.
  - `Event = typeof events.$inferSelect`, `NewEvent = typeof events.$inferInsert`.
  - `type CreateEventInput = { promotionId: string; name: string; startDate: string; endDate?: string; venue?: string; location?: string; sourceUrl?: string; verifiedBy?: string; confidence?: "CONFIRMED" | "NEEDS_REVIEW"; status?: "draft" | "published" }`
  - `createEvent(db: Db, input: CreateEventInput): Promise<Event>`
  - `searchEvents(db: Db, query: string): Promise<{ id: string; name: string; slug: string }[]>`
  - `getEvent(db: Db, id: string): Promise<Event | null>`

Note: `startDate`/`endDate` are Drizzle `date` columns, which serialize as `YYYY-MM-DD` strings — inputs and outputs are strings, not `Date` objects.

- [ ] **Step 1: Write the failing schema test**

`src/db/schema/event.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { events } from "@/db/schema/event";

describe("event schema", () => {
  it("defines identity, promotion link, dates, and provenance columns", () => {
    const cols = Object.keys(getTableColumns(events));
    for (const c of [
      "id", "slug", "promotionId", "name", "startDate", "endDate",
      "venue", "location", "status", "sourceUrl", "verifiedBy",
      "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/db/schema/event.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/event`.

- [ ] **Step 3: Write the schema**

`src/db/schema/event.ts`:

```ts
import {
  pgTable, uuid, text, date, timestamp, index,
} from "drizzle-orm/pg-core";
import { promotions } from "./promotion";

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    venue: text("venue"),
    location: text("location"),
    sourceUrl: text("source_url"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confidence: text("confidence", { enum: ["CONFIRMED", "NEEDS_REVIEW"] })
      .notNull()
      .default("NEEDS_REVIEW"),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("events_promotion_id_idx").on(t.promotionId)],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
```

Append to `src/db/schema/index.ts`:

```ts
export * from "./event";
```

- [ ] **Step 4: Run to verify the schema test passes**

Run: `npm test src/db/schema/event.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` containing `CREATE TABLE "events"` with a foreign key to `promotions`. Confirm.

- [ ] **Step 6: Write the failing service test**

`src/lib/events/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent, searchEvents, getEvent } from "@/lib/events/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedPromotion() {
  return createPromotion(ctx.db, { name: "Abu Dhabi Combat Club", shortName: "ADCC" });
}

describe("createEvent", () => {
  it("creates an event linked to a promotion with a derived slug", async () => {
    const p = await seedPromotion();
    const e = await createEvent(ctx.db, {
      promotionId: p.id,
      name: "ADCC 2022 World Championship",
      startDate: "2022-09-17",
      endDate: "2022-09-18",
      location: "Las Vegas, NV, USA",
    });
    expect(e.slug).toBe("adcc-2022-world-championship");
    expect(e.promotionId).toBe(p.id);
    expect(e.startDate).toBe("2022-09-17");
    expect(e.status).toBe("draft");
  });

  it("disambiguates slug collisions", async () => {
    const p = await seedPromotion();
    const a = await createEvent(ctx.db, { promotionId: p.id, name: "Trials", startDate: "2024-01-01" });
    const b = await createEvent(ctx.db, { promotionId: p.id, name: "Trials", startDate: "2024-06-01" });
    expect(a.slug).toBe("trials");
    expect(b.slug).toBe("trials-2");
  });
});

describe("searchEvents / getEvent", () => {
  it("finds by substring and fetches by id", async () => {
    const p = await seedPromotion();
    const e = await createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2024 Worlds", startDate: "2024-08-17" });
    const rows = await searchEvents(ctx.db, "2024");
    expect(rows[0]?.id).toBe(e.id);
    const fetched = await getEvent(ctx.db, e.id);
    expect(fetched?.name).toBe("ADCC 2024 Worlds");
    expect(await getEvent(ctx.db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test src/lib/events/service.test.ts`
Expected: FAIL — cannot resolve `@/lib/events/service`.

- [ ] **Step 8: Implement the service**

`src/lib/events/service.ts`:

```ts
import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, type Event } from "@/db/schema/event";
import { slugify } from "@/lib/identity/normalize";

export type CreateEventInput = {
  promotionId: string;
  name: string;
  startDate: string;
  endDate?: string;
  venue?: string;
  location?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || "event";
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function createEvent(
  db: Db,
  input: CreateEventInput,
): Promise<Event> {
  const slug = await uniqueSlug(db, input.name);
  const rows = await db
    .insert(events)
    .values({
      slug,
      promotionId: input.promotionId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      venue: input.venue ?? null,
      location: input.location ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
      status: input.status ?? "draft",
    })
    .returning();
  const event = rows[0];
  if (!event) throw new Error("createEvent: insert returned no rows");
  return event;
}

export async function searchEvents(
  db: Db,
  query: string,
): Promise<{ id: string; name: string; slug: string }[]> {
  return db
    .select({ id: events.id, name: events.name, slug: events.slug })
    .from(events)
    .where(ilike(events.name, `%${query}%`))
    .limit(10);
}

export async function getEvent(db: Db, id: string): Promise<Event | null> {
  const rows = await db.select().from(events).where(eq(events.id, id));
  return rows[0] ?? null;
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm test src/lib/events/service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add event schema + write-path service"
```

---

### Task 3: Match + MatchCompetitor schema + transactional write-path

**Files:**
- Create: `src/db/schema/match.ts`
- Modify: `src/db/schema/index.ts` (add `export * from "./match";`)
- Create: `src/lib/matches/service.ts`
- Test: `src/db/schema/match.test.ts`
- Test: `src/lib/matches/service.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb`, `athletes`/`createAthlete` (A.1), `events`/`createEvent` (Task 2), `promotions`/`createPromotion` (Task 1).
- Produces:
  - `matches` table: `id` (uuid pk), `eventId` (uuid fk → events.id, indexed), `matchType` (enum), `round` (text nullable), `weightClass` (text nullable), `ruleset` (text nullable), `method` (enum), `methodDetail` (text nullable), `durationSeconds` (integer nullable), provenance block, `status` (`'draft'|'published'` default `'draft'`), `createdAt`, `updatedAt`.
  - `matchCompetitors` table: `id` (uuid pk), `matchId` (uuid fk → matches.id, **cascade delete**, indexed), `athleteId` (uuid fk → athletes.id, indexed), `outcome` (enum), `slotOrder` (smallint nullable); **unique(matchId, athleteId)**.
  - `Match = typeof matches.$inferSelect`, `MatchCompetitor = typeof matchCompetitors.$inferSelect`.
  - `type MatchCompetitorInput = { athleteId: string; outcome: "WON" | "LOST" | "DRAW" | "NC" | "DQ"; slotOrder?: number }`
  - `type CreateMatchInput = { eventId: string; matchType: "BRACKET" | "SUPERFIGHT" | "TRIAL" | "ALTERNATE"; round?: string; weightClass?: string; ruleset?: string; method: "SUBMISSION" | "POINTS" | "DECISION" | "DQ" | "OVERTIME" | "FORFEIT" | "NC" | "DRAW"; methodDetail?: string; durationSeconds?: number; competitors: MatchCompetitorInput[]; sourceUrl?: string; verifiedBy?: string; confidence?: "CONFIRMED" | "NEEDS_REVIEW"; status?: "draft" | "published" }`
  - `createMatch(db: Db, input: CreateMatchInput): Promise<Match>` — inserts the match and all competitor rows in **one transaction**.
  - `listMatchesForEvent(db: Db, eventId: string): Promise<Match[]>`
  - `type AthleteRecord = { wins: number; losses: number; draws: number; noContests: number; dqs: number; submissionWins: number }`
  - `athleteRecord(db: Db, athleteId: string): Promise<AthleteRecord>` — the derived record + submission-breakdown query over `match_competitors` ⋈ `matches`.

- [ ] **Step 1: Write the failing schema test**

`src/db/schema/match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { matches, matchCompetitors } from "@/db/schema/match";

describe("match schema", () => {
  it("defines shared match facts and provenance", () => {
    const cols = Object.keys(getTableColumns(matches));
    for (const c of [
      "id", "eventId", "matchType", "round", "weightClass", "ruleset",
      "method", "methodDetail", "durationSeconds", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("defines the competitor join columns", () => {
    const cols = Object.keys(getTableColumns(matchCompetitors));
    for (const c of ["id", "matchId", "athleteId", "outcome", "slotOrder"]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/db/schema/match.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/match`.

- [ ] **Step 3: Write the schema**

`src/db/schema/match.ts`:

```ts
import {
  pgTable, uuid, text, integer, smallint, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { events } from "./event";
import { athletes } from "./athlete";

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    matchType: text("match_type", {
      enum: ["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"],
    }).notNull(),
    round: text("round"),
    weightClass: text("weight_class"),
    ruleset: text("ruleset"),
    method: text("method", {
      enum: ["SUBMISSION", "POINTS", "DECISION", "DQ", "OVERTIME", "FORFEIT", "NC", "DRAW"],
    }).notNull(),
    methodDetail: text("method_detail"),
    durationSeconds: integer("duration_seconds"),
    sourceUrl: text("source_url"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confidence: text("confidence", { enum: ["CONFIRMED", "NEEDS_REVIEW"] })
      .notNull()
      .default("NEEDS_REVIEW"),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("matches_event_id_idx").on(t.eventId)],
);

export const matchCompetitors = pgTable(
  "match_competitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    outcome: text("outcome", {
      enum: ["WON", "LOST", "DRAW", "NC", "DQ"],
    }).notNull(),
    slotOrder: smallint("slot_order"),
  },
  (t) => [
    index("match_competitors_match_id_idx").on(t.matchId),
    index("match_competitors_athlete_id_idx").on(t.athleteId),
    unique("match_competitors_match_athlete_uq").on(t.matchId, t.athleteId),
  ],
);

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchCompetitor = typeof matchCompetitors.$inferSelect;
```

Append to `src/db/schema/index.ts`:

```ts
export * from "./match";
```

- [ ] **Step 4: Run to verify the schema test passes**

Run: `npm test src/db/schema/match.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0003_*.sql` with `CREATE TABLE "matches"` and `CREATE TABLE "match_competitors"`, the cascade FK, and the unique constraint. Confirm it contains `ON DELETE cascade` and a unique index/constraint on `(match_id, athlete_id)`.

- [ ] **Step 6: Write the failing service test**

`src/lib/matches/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch, listMatchesForEvent, athleteRecord } from "@/lib/matches/service";
import { matches } from "@/db/schema/match";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedEvent() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  return createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
}

describe("createMatch", () => {
  it("inserts a match and its two competitors atomically", async () => {
    const event = await seedEvent();
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const andre = await createAthlete(ctx.db, { fullName: "Andre Galvao" });

    const match = await createMatch(ctx.db, {
      eventId: event.id,
      matchType: "SUPERFIGHT",
      weightClass: "Absolute",
      ruleset: "ADCC",
      method: "SUBMISSION",
      methodDetail: "RNC",
      durationSeconds: 400,
      competitors: [
        { athleteId: gordon.id, outcome: "WON", slotOrder: 1 },
        { athleteId: andre.id, outcome: "LOST", slotOrder: 2 },
      ],
    });

    expect(match.method).toBe("SUBMISSION");
    const forEvent = await listMatchesForEvent(ctx.db, event.id);
    expect(forEvent).toHaveLength(1);
  });

  it("rolls back the match when a competitor insert fails", async () => {
    const event = await seedEvent();
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });

    await expect(
      createMatch(ctx.db, {
        eventId: event.id,
        matchType: "SUPERFIGHT",
        method: "POINTS",
        competitors: [
          { athleteId: gordon.id, outcome: "WON" },
          // Non-existent athlete → FK violation → whole tx rolls back.
          { athleteId: "00000000-0000-0000-0000-000000000000", outcome: "LOST" },
        ],
      }),
    ).rejects.toThrow();

    const all = await ctx.db.select().from(matches);
    expect(all).toHaveLength(0); // no orphan match row
  });
});

describe("athleteRecord", () => {
  it("computes W-L-D and submission wins across matches", async () => {
    const event = await seedEvent();
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const opp = await createAthlete(ctx.db, { fullName: "Opponent" });

    // Win by submission
    await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "SUBMISSION",
      competitors: [
        { athleteId: gordon.id, outcome: "WON" },
        { athleteId: opp.id, outcome: "LOST" },
      ],
    });
    // Win by points
    await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "POINTS",
      competitors: [
        { athleteId: gordon.id, outcome: "WON" },
        { athleteId: opp.id, outcome: "LOST" },
      ],
    });
    // Loss
    await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "DECISION",
      competitors: [
        { athleteId: gordon.id, outcome: "LOST" },
        { athleteId: opp.id, outcome: "WON" },
      ],
    });

    const rec = await athleteRecord(ctx.db, gordon.id);
    expect(rec.wins).toBe(2);
    expect(rec.losses).toBe(1);
    expect(rec.submissionWins).toBe(1);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test src/lib/matches/service.test.ts`
Expected: FAIL — cannot resolve `@/lib/matches/service`.

- [ ] **Step 8: Implement the service**

`src/lib/matches/service.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors, type Match } from "@/db/schema/match";

export type MatchCompetitorInput = {
  athleteId: string;
  outcome: "WON" | "LOST" | "DRAW" | "NC" | "DQ";
  slotOrder?: number;
};

export type CreateMatchInput = {
  eventId: string;
  matchType: "BRACKET" | "SUPERFIGHT" | "TRIAL" | "ALTERNATE";
  round?: string;
  weightClass?: string;
  ruleset?: string;
  method:
    | "SUBMISSION" | "POINTS" | "DECISION" | "DQ"
    | "OVERTIME" | "FORFEIT" | "NC" | "DRAW";
  methodDetail?: string;
  durationSeconds?: number;
  competitors: MatchCompetitorInput[];
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

export async function createMatch(
  db: Db,
  input: CreateMatchInput,
): Promise<Match> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(matches)
      .values({
        eventId: input.eventId,
        matchType: input.matchType,
        round: input.round ?? null,
        weightClass: input.weightClass ?? null,
        ruleset: input.ruleset ?? null,
        method: input.method,
        methodDetail: input.methodDetail ?? null,
        durationSeconds: input.durationSeconds ?? null,
        sourceUrl: input.sourceUrl ?? null,
        verifiedBy: input.verifiedBy ?? null,
        verifiedAt: input.verifiedBy ? new Date() : null,
        confidence: input.confidence ?? "NEEDS_REVIEW",
        status: input.status ?? "draft",
      })
      .returning();
    const match = rows[0];
    if (!match) throw new Error("createMatch: insert returned no rows");

    if (input.competitors.length) {
      await tx.insert(matchCompetitors).values(
        input.competitors.map((c) => ({
          matchId: match.id,
          athleteId: c.athleteId,
          outcome: c.outcome,
          slotOrder: c.slotOrder ?? null,
        })),
      );
    }
    return match;
  });
}

export async function listMatchesForEvent(
  db: Db,
  eventId: string,
): Promise<Match[]> {
  return db.select().from(matches).where(eq(matches.eventId, eventId));
}

export type AthleteRecord = {
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  dqs: number;
  submissionWins: number;
};

export async function athleteRecord(
  db: Db,
  athleteId: string,
): Promise<AthleteRecord> {
  const rows = await db
    .select({ outcome: matchCompetitors.outcome, method: matches.method })
    .from(matchCompetitors)
    .innerJoin(matches, eq(matchCompetitors.matchId, matches.id))
    .where(eq(matchCompetitors.athleteId, athleteId));

  const rec: AthleteRecord = {
    wins: 0, losses: 0, draws: 0, noContests: 0, dqs: 0, submissionWins: 0,
  };
  for (const r of rows) {
    if (r.outcome === "WON") {
      rec.wins += 1;
      if (r.method === "SUBMISSION") rec.submissionWins += 1;
    } else if (r.outcome === "LOST") rec.losses += 1;
    else if (r.outcome === "DRAW") rec.draws += 1;
    else if (r.outcome === "NC") rec.noContests += 1;
    else if (r.outcome === "DQ") rec.dqs += 1;
  }
  return rec;
}
```

Note: `and` is imported for parity with sibling services even if unused here; remove it if your linter flags unused imports.

- [ ] **Step 9: Run to verify it passes**

Run: `npm test src/lib/matches/service.test.ts`
Expected: PASS (4 tests). If `db.transaction` produces a TypeScript union-type error on the `Db` type, the runtime driver and pglite driver both expose `.transaction` with compatible callbacks — cast the callback param as needed, but do not change the `Db` union (it is shared with A.1 services).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add match + match_competitors schema and transactional write-path"
```

---

### Task 4: Placement schema + write-path service

**Files:**
- Create: `src/db/schema/placement.ts`
- Modify: `src/db/schema/index.ts` (add `export * from "./placement";`)
- Create: `src/lib/placements/service.ts`
- Test: `src/db/schema/placement.test.ts`
- Test: `src/lib/placements/service.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb`, `athletes`/`createAthlete`, `events`/`createEvent`, `promotions`/`createPromotion`.
- Produces:
  - `placements` table: `id` (uuid pk), `eventId` (uuid fk → events.id, indexed), `athleteId` (uuid fk → athletes.id, indexed), `division` (text), `place` (smallint), provenance block, `createdAt`, `updatedAt`; **unique(eventId, athleteId, division)**. No `status` column.
  - `Placement = typeof placements.$inferSelect`.
  - `type AddPlacementInput = { eventId: string; athleteId: string; division: string; place: number; sourceUrl?: string; verifiedBy?: string; confidence?: "CONFIRMED" | "NEEDS_REVIEW" }`
  - `addPlacement(db: Db, input: AddPlacementInput): Promise<Placement>`
  - `listPlacementsForEvent(db: Db, eventId: string): Promise<Placement[]>`

- [ ] **Step 1: Write the failing schema test**

`src/db/schema/placement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { placements } from "@/db/schema/placement";

describe("placement schema", () => {
  it("defines medal columns and provenance, without an independent status", () => {
    const cols = Object.keys(getTableColumns(placements));
    for (const c of [
      "id", "eventId", "athleteId", "division", "place",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toContain("status");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/db/schema/placement.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/placement`.

- [ ] **Step 3: Write the schema**

`src/db/schema/placement.ts`:

```ts
import {
  pgTable, uuid, text, smallint, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { events } from "./event";
import { athletes } from "./athlete";

export const placements = pgTable(
  "placements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    division: text("division").notNull(),
    place: smallint("place").notNull(),
    sourceUrl: text("source_url"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confidence: text("confidence", { enum: ["CONFIRMED", "NEEDS_REVIEW"] })
      .notNull()
      .default("NEEDS_REVIEW"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("placements_event_id_idx").on(t.eventId),
    index("placements_athlete_id_idx").on(t.athleteId),
    unique("placements_event_athlete_division_uq").on(
      t.eventId, t.athleteId, t.division,
    ),
  ],
);

export type Placement = typeof placements.$inferSelect;
export type NewPlacement = typeof placements.$inferInsert;
```

Append to `src/db/schema/index.ts`:

```ts
export * from "./placement";
```

- [ ] **Step 4: Run to verify the schema test passes**

Run: `npm test src/db/schema/placement.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0004_*.sql` with `CREATE TABLE "placements"` and a unique constraint on `(event_id, athlete_id, division)`. Confirm.

- [ ] **Step 6: Write the failing service test**

`src/lib/placements/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { addPlacement, listPlacementsForEvent } from "@/lib/placements/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedEventAndAthlete() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  const event = await createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
  const athlete = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
  return { event, athlete };
}

describe("addPlacement", () => {
  it("records a podium finish for a division", async () => {
    const { event, athlete } = await seedEventAndAthlete();
    const pl = await addPlacement(ctx.db, {
      eventId: event.id, athleteId: athlete.id, division: "Absolute", place: 1,
    });
    expect(pl.place).toBe(1);
    const forEvent = await listPlacementsForEvent(ctx.db, event.id);
    expect(forEvent).toHaveLength(1);
  });

  it("rejects a duplicate (event, athlete, division) placement", async () => {
    const { event, athlete } = await seedEventAndAthlete();
    await addPlacement(ctx.db, { eventId: event.id, athleteId: athlete.id, division: "Absolute", place: 1 });
    await expect(
      addPlacement(ctx.db, { eventId: event.id, athleteId: athlete.id, division: "Absolute", place: 2 }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test src/lib/placements/service.test.ts`
Expected: FAIL — cannot resolve `@/lib/placements/service`.

- [ ] **Step 8: Implement the service**

`src/lib/placements/service.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { placements, type Placement } from "@/db/schema/placement";

export type AddPlacementInput = {
  eventId: string;
  athleteId: string;
  division: string;
  place: number;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
};

export async function addPlacement(
  db: Db,
  input: AddPlacementInput,
): Promise<Placement> {
  const rows = await db
    .insert(placements)
    .values({
      eventId: input.eventId,
      athleteId: input.athleteId,
      division: input.division,
      place: input.place,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();
  const placement = rows[0];
  if (!placement) throw new Error("addPlacement: insert returned no rows");
  return placement;
}

export async function listPlacementsForEvent(
  db: Db,
  eventId: string,
): Promise<Placement[]> {
  return db.select().from(placements).where(eq(placements.eventId, eventId));
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm test src/lib/placements/service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS — A.1 tests plus all new schema + service tests green. Also run `npx tsc --noEmit` and confirm it is clean.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add placement schema + write-path service"
```

---

### Task 5: Promotion + Event admin routes and forms

**Files:**
- Create: `src/app/api/admin/promotions/route.ts`
- Create: `src/app/api/admin/events/route.ts`
- Create: `src/app/admin/promotions/new/page.tsx`
- Create: `src/app/admin/promotions/new/promotion-form.tsx`
- Create: `src/app/admin/events/new/page.tsx`
- Create: `src/app/admin/events/new/event-form.tsx`
- Test: `src/app/api/admin/promotions/route.test.ts`
- Test: `src/app/api/admin/events/route.test.ts`

**Interfaces:**
- Consumes: `createPromotion`/`searchPromotions` (Task 1), `createEvent`/`searchEvents` (Task 2), `db` (`src/db/client.ts`).
- Produces:
  - `POST /api/admin/promotions` (Zod `CreatePromotionSchema` → `createPromotion`, `201`), `GET /api/admin/promotions?q=` (→ `searchPromotions`).
  - `POST /api/admin/events` (Zod `CreateEventSchema` → `createEvent`, `201`), `GET /api/admin/events?q=` (→ `searchEvents`).
  - `CreatePromotionSchema`, `CreateEventSchema` exported for reuse.
  - Client forms for creating a promotion and an event (event form resolves its promotion via a typeahead over `GET /api/admin/promotions`).

- [ ] **Step 1: Write the failing schema tests**

`src/app/api/admin/promotions/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreatePromotionSchema } from "@/app/api/admin/promotions/route";

describe("CreatePromotionSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreatePromotionSchema.parse({ name: "ADCC", shortName: "ADCC" });
    expect(parsed.name).toBe("ADCC");
  });
  it("rejects an empty name", () => {
    expect(() => CreatePromotionSchema.parse({ name: "" })).toThrow();
  });
});
```

`src/app/api/admin/events/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreateEventSchema } from "@/app/api/admin/events/route";

describe("CreateEventSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreateEventSchema.parse({
      promotionId: "11111111-1111-1111-1111-111111111111",
      name: "ADCC 2022",
      startDate: "2022-09-17",
    });
    expect(parsed.name).toBe("ADCC 2022");
  });
  it("rejects a non-uuid promotionId", () => {
    expect(() =>
      CreateEventSchema.parse({ promotionId: "nope", name: "X", startDate: "2022-09-17" }),
    ).toThrow();
  });
  it("rejects a malformed date", () => {
    expect(() =>
      CreateEventSchema.parse({
        promotionId: "11111111-1111-1111-1111-111111111111",
        name: "X",
        startDate: "Sept 17",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test src/app/api/admin/promotions/route.test.ts src/app/api/admin/events/route.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Implement the promotions route**

`src/app/api/admin/promotions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createPromotion, searchPromotions } from "@/lib/promotions/service";

export const CreatePromotionSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreatePromotionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const promotion = await createPromotion(db, parsed.data);
  return NextResponse.json(promotion, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchPromotions(db, q));
}
```

- [ ] **Step 4: Implement the events route**

`src/app/api/admin/events/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createEvent, searchEvents } from "@/lib/events/service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CreateEventSchema = z.object({
  promotionId: z.string().uuid(),
  name: z.string().min(1),
  startDate: z.string().regex(ISO_DATE, "expected YYYY-MM-DD"),
  endDate: z.string().regex(ISO_DATE).optional(),
  venue: z.string().optional(),
  location: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const event = await createEvent(db, parsed.data);
  return NextResponse.json(event, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchEvents(db, q));
}
```

- [ ] **Step 5: Implement the promotion entry page and form**

`src/app/admin/promotions/new/page.tsx`:

```tsx
import { PromotionForm } from "./promotion-form";

export default function NewPromotionPage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New promotion</h1>
      <PromotionForm />
    </main>
  );
}
```

`src/app/admin/promotions/new/promotion-form.tsx`:

```tsx
"use client";
import { useState } from "react";

export function PromotionForm() {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/promotions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, shortName: shortName || undefined }),
    });
    setResult(res.ok ? "Created" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Short name
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} />
      </label>
      <button type="submit" disabled={!name}>Create</button>
      {result && <p>{result}</p>}
    </form>
  );
}
```

- [ ] **Step 6: Implement the event entry page and form**

`src/app/admin/events/new/page.tsx`:

```tsx
import { EventForm } from "./event-form";

export default function NewEventPage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New event</h1>
      <EventForm />
    </main>
  );
}
```

`src/app/admin/events/new/event-form.tsx`:

```tsx
"use client";
import { useState } from "react";

type Promotion = { id: string; name: string; slug: string };

export function EventForm() {
  const [promoQuery, setPromoQuery] = useState("");
  const [promoResults, setPromoResults] = useState<Promotion[]>([]);
  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function searchPromos(q: string) {
    setPromoQuery(q);
    setPromotionId(null);
    if (!q) { setPromoResults([]); return; }
    const res = await fetch(`/api/admin/promotions?q=${encodeURIComponent(q)}`);
    setPromoResults(await res.json());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!promotionId) return;
    const res = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promotionId, name, startDate }),
    });
    setResult(res.ok ? "Created" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <label>Promotion
        <input
          value={promoQuery}
          onChange={(e) => searchPromos(e.target.value)}
          placeholder="Search promotions…"
        />
      </label>
      {promoResults.length > 0 && !promotionId && (
        <ul>
          {promoResults.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { setPromotionId(p.id); setPromoQuery(p.name); setPromoResults([]); }}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>Event name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Start date
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <button type="submit" disabled={!promotionId || !name || !startDate}>Create</button>
      {result && <p>{result}</p>}
    </form>
  );
}
```

- [ ] **Step 7: Run to verify the schema tests pass**

Run: `npm test src/app/api/admin/promotions/route.test.ts src/app/api/admin/events/route.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add promotion + event admin routes and entry forms"
```

---

### Task 6: Event hub with inline match + placement entry

**Files:**
- Create: `src/app/api/admin/matches/route.ts`
- Create: `src/app/api/admin/placements/route.ts`
- Create: `src/app/admin/events/[id]/page.tsx`
- Create: `src/app/admin/events/[id]/match-form.tsx`
- Create: `src/app/admin/events/[id]/placement-form.tsx`
- Test: `src/app/api/admin/matches/route.test.ts`
- Test: `src/app/api/admin/placements/route.test.ts`

**Interfaces:**
- Consumes: `createMatch`/`listMatchesForEvent` (Task 3), `addPlacement`/`listPlacementsForEvent` (Task 4), `getEvent` (Task 2), `db`. Reuses A.1 endpoints `GET /api/admin/athletes?q=` (athlete typeahead), `GET /api/admin/athletes/duplicates?name=` and `POST /api/admin/athletes` (inline athlete creation with duplicate gate) — no changes to A.1 code.
- Produces:
  - `POST /api/admin/matches` (Zod `CreateMatchSchema` → `createMatch`, `201`).
  - `POST /api/admin/placements` (Zod `AddPlacementSchema` → `addPlacement`, `201`).
  - `CreateMatchSchema`, `AddPlacementSchema` exported.
  - `/admin/events/[id]` server page: shows the event, its already-entered matches and placements, and the inline `MatchForm` + `PlacementForm` (both resolve athletes via the A.1 athlete typeahead).

- [ ] **Step 1: Write the failing schema tests**

`src/app/api/admin/matches/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreateMatchSchema } from "@/app/api/admin/matches/route";

const uuid = "11111111-1111-1111-1111-111111111111";

describe("CreateMatchSchema", () => {
  it("accepts a valid two-competitor match", () => {
    const parsed = CreateMatchSchema.parse({
      eventId: uuid,
      matchType: "SUPERFIGHT",
      method: "SUBMISSION",
      methodDetail: "RNC",
      competitors: [
        { athleteId: uuid, outcome: "WON" },
        { athleteId: uuid, outcome: "LOST" },
      ],
    });
    expect(parsed.competitors).toHaveLength(2);
  });
  it("requires at least two competitors", () => {
    expect(() =>
      CreateMatchSchema.parse({
        eventId: uuid, matchType: "SUPERFIGHT", method: "POINTS",
        competitors: [{ athleteId: uuid, outcome: "WON" }],
      }),
    ).toThrow();
  });
  it("rejects an unknown method", () => {
    expect(() =>
      CreateMatchSchema.parse({
        eventId: uuid, matchType: "SUPERFIGHT", method: "MAGIC",
        competitors: [
          { athleteId: uuid, outcome: "WON" },
          { athleteId: uuid, outcome: "LOST" },
        ],
      }),
    ).toThrow();
  });
});
```

`src/app/api/admin/placements/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AddPlacementSchema } from "@/app/api/admin/placements/route";

const uuid = "11111111-1111-1111-1111-111111111111";

describe("AddPlacementSchema", () => {
  it("accepts a valid placement", () => {
    const parsed = AddPlacementSchema.parse({
      eventId: uuid, athleteId: uuid, division: "Absolute", place: 1,
    });
    expect(parsed.place).toBe(1);
  });
  it("rejects place outside 1..3", () => {
    expect(() =>
      AddPlacementSchema.parse({ eventId: uuid, athleteId: uuid, division: "Absolute", place: 4 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test src/app/api/admin/matches/route.test.ts src/app/api/admin/placements/route.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Implement the matches route**

`src/app/api/admin/matches/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createMatch } from "@/lib/matches/service";

const CompetitorSchema = z.object({
  athleteId: z.string().uuid(),
  outcome: z.enum(["WON", "LOST", "DRAW", "NC", "DQ"]),
  slotOrder: z.number().int().optional(),
});

export const CreateMatchSchema = z.object({
  eventId: z.string().uuid(),
  matchType: z.enum(["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"]),
  round: z.string().optional(),
  weightClass: z.string().optional(),
  ruleset: z.string().optional(),
  method: z.enum([
    "SUBMISSION", "POINTS", "DECISION", "DQ", "OVERTIME", "FORFEIT", "NC", "DRAW",
  ]),
  methodDetail: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  competitors: z.array(CompetitorSchema).min(2),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateMatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const match = await createMatch(db, parsed.data);
  return NextResponse.json(match, { status: 201 });
}
```

- [ ] **Step 4: Implement the placements route**

`src/app/api/admin/placements/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { addPlacement } from "@/lib/placements/service";

export const AddPlacementSchema = z.object({
  eventId: z.string().uuid(),
  athleteId: z.string().uuid(),
  division: z.string().min(1),
  place: z.number().int().min(1).max(3),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = AddPlacementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const placement = await addPlacement(db, parsed.data);
  return NextResponse.json(placement, { status: 201 });
}
```

- [ ] **Step 5: Implement the athlete-picker shared client component**

`src/app/admin/events/[id]/athlete-picker.tsx`:

```tsx
"use client";
import { useState } from "react";

type Athlete = { id: string; fullName: string; slug: string };
type Dup = { id: string; name: string; score: number };

export function AthletePicker(
  { label, onPick }: { label: string; onPick: (a: { id: string; name: string }) => void },
) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Athlete[]>([]);
  const [dups, setDups] = useState<Dup[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (!q) { setResults([]); return; }
    const res = await fetch(`/api/admin/athletes?q=${encodeURIComponent(q)}`);
    setResults(await res.json());
  }

  async function checkDuplicates() {
    if (!query) return;
    const res = await fetch(`/api/admin/athletes/duplicates?name=${encodeURIComponent(query)}`);
    const found: Dup[] = await res.json();
    setDups(found);
    setAcknowledged(found.length === 0);
  }

  async function createNew() {
    const res = await fetch("/api/admin/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: query }),
    });
    if (res.ok) {
      const a = await res.json();
      onPick({ id: a.id, name: a.fullName });
      setResults([]); setDups([]);
    }
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 8, margin: "4px 0" }}>
      <label>{label}
        <input value={query} onChange={(e) => search(e.target.value)} onBlur={checkDuplicates} />
      </label>
      {results.length > 0 && (
        <ul>
          {results.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => { onPick({ id: a.id, name: a.fullName }); setResults([]); setQuery(a.fullName); }}>
                {a.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dups.length > 0 && (
        <div style={{ border: "1px solid #c00", padding: 8 }}>
          <strong>Possible duplicates:</strong>
          <ul>{dups.map((d) => <li key={d.id}>{d.name} ({d.score.toFixed(2)})</li>)}</ul>
          <label>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            This is a new, distinct athlete
          </label>
        </div>
      )}
      <button type="button" disabled={!query || !acknowledged} onClick={createNew}>
        Create &amp; use “{query}”
      </button>
    </div>
  );
}
```

Note: the duplicate-check gate here is UI-only, exactly as in A.1. Server-side enforcement is an inherited, tracked follow-up (see the deferred-items section) — not in scope for this plan.

- [ ] **Step 6: Implement the match form**

`src/app/admin/events/[id]/match-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { AthletePicker } from "./athlete-picker";

const METHODS = ["SUBMISSION", "POINTS", "DECISION", "DQ", "OVERTIME", "FORFEIT", "NC", "DRAW"];
const TYPES = ["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"];

export function MatchForm({ eventId }: { eventId: string }) {
  const [matchType, setMatchType] = useState("SUPERFIGHT");
  const [method, setMethod] = useState("SUBMISSION");
  const [methodDetail, setMethodDetail] = useState("");
  const [weightClass, setWeightClass] = useState("");
  const [ruleset, setRuleset] = useState("");
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(null);
  const [loser, setLoser] = useState<{ id: string; name: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!winner || !loser) return;
    const res = await fetch("/api/admin/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId, matchType, method,
        methodDetail: methodDetail || undefined,
        weightClass: weightClass || undefined,
        ruleset: ruleset || undefined,
        competitors: [
          { athleteId: winner.id, outcome: "WON", slotOrder: 1 },
          { athleteId: loser.id, outcome: "LOST", slotOrder: 2 },
        ],
      }),
    });
    setResult(res.ok ? "Match added" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <h3>Add match</h3>
      <label>Type
        <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label>Weight class
        <input value={weightClass} onChange={(e) => setWeightClass(e.target.value)} placeholder="-88kg / Absolute" />
      </label>
      <label>Ruleset
        <input value={ruleset} onChange={(e) => setRuleset(e.target.value)} placeholder="ADCC / EBI Overtime" />
      </label>
      <label>Method
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      {method === "SUBMISSION" && (
        <label>Submission
          <input value={methodDetail} onChange={(e) => setMethodDetail(e.target.value)} placeholder="RNC / heel hook" />
        </label>
      )}
      <p>Winner {winner ? `— ${winner.name}` : ""}</p>
      <AthletePicker label="Winner" onPick={setWinner} />
      <p>Loser {loser ? `— ${loser.name}` : ""}</p>
      <AthletePicker label="Loser" onPick={setLoser} />
      <button type="submit" disabled={!winner || !loser}>Add match</button>
      {result && <p>{result}</p>}
    </form>
  );
}
```

- [ ] **Step 7: Implement the placement form**

`src/app/admin/events/[id]/placement-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { AthletePicker } from "./athlete-picker";

export function PlacementForm({ eventId }: { eventId: string }) {
  const [athlete, setAthlete] = useState<{ id: string; name: string } | null>(null);
  const [division, setDivision] = useState("");
  const [place, setPlace] = useState(1);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete) return;
    const res = await fetch("/api/admin/placements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId, athleteId: athlete.id, division, place }),
    });
    setResult(res.ok ? "Placement added" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <h3>Add placement</h3>
      <p>Athlete {athlete ? `— ${athlete.name}` : ""}</p>
      <AthletePicker label="Athlete" onPick={setAthlete} />
      <label>Division
        <input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="-88kg / Absolute" />
      </label>
      <label>Place
        <select value={place} onChange={(e) => setPlace(Number(e.target.value))}>
          <option value={1}>1 — Gold</option>
          <option value={2}>2 — Silver</option>
          <option value={3}>3 — Bronze</option>
        </select>
      </label>
      <button type="submit" disabled={!athlete || !division}>Add placement</button>
      {result && <p>{result}</p>}
    </form>
  );
}
```

- [ ] **Step 8: Implement the event hub page**

`src/app/admin/events/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getEvent } from "@/lib/events/service";
import { listMatchesForEvent } from "@/lib/matches/service";
import { listPlacementsForEvent } from "@/lib/placements/service";
import { MatchForm } from "./match-form";
import { PlacementForm } from "./placement-form";

export default async function EventHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getEvent(db, id);
  if (!event) notFound();
  const matches = await listMatchesForEvent(db, id);
  const placements = await listPlacementsForEvent(db, id);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{event.name}</h1>
      <p>{event.startDate}{event.location ? ` · ${event.location}` : ""}</p>

      <section>
        <h2>Matches ({matches.length})</h2>
        <ul>
          {matches.map((m) => (
            <li key={m.id}>{m.matchType} · {m.weightClass ?? "—"} · {m.method}{m.methodDetail ? ` (${m.methodDetail})` : ""}</li>
          ))}
        </ul>
        <MatchForm eventId={id} />
      </section>

      <section>
        <h2>Placements ({placements.length})</h2>
        <ul>
          {placements.map((p) => (
            <li key={p.id}>{p.division} · #{p.place}</li>
          ))}
        </ul>
        <PlacementForm eventId={id} />
      </section>
    </main>
  );
}
```

- [ ] **Step 9: Run to verify the schema tests pass and the full suite is green**

Run: `npm test`
Expected: PASS — all A.1 and A.2 tests, including the new match/placement schema tests. Then run `npx tsc --noEmit` and confirm it is clean.

- [ ] **Step 10: Manually verify the flow end-to-end**

Set `DATABASE_URL` in `.env` to a real Postgres (Neon/Supabase free tier), then:

```bash
npm run db:migrate
npm run dev
```

- Visit `/admin/promotions/new`, create "Abu Dhabi Combat Club" (ADCC).
- Visit `/admin/events/new`, search the promotion, pick it, create "ADCC 2022 World Championship" (start date 2022-09-17). Note the created event's `id` from the network response (or query the DB).
- Visit `/admin/events/<id>`. Add a match: SUPERFIGHT, Absolute, ADCC, SUBMISSION/RNC; use the winner/loser pickers (create the athletes inline — confirm the duplicate panel appears for a near-name and gates the "Create & use" button). Confirm the match appears in the list on reload.
- Add a placement: Absolute, Gold, an athlete. Confirm it appears.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add event hub with inline match + placement entry"
```

---

## Self-Review

**Spec coverage (design doc §1–§7):**
- `promotions` schema + service → Task 1. ✓
- `events` schema + service (FK to promotion, dates, venue/location) → Task 2. ✓
- `matches` + `match_competitors` schema, closed enums, transactional `createMatch`, cascade, unique(match_id, athlete_id) → Task 3. ✓
- `placements` schema (no status, unique(event_id, athlete_id, division)) + service → Task 4. ✓
- Provenance block on every entity; draft/published on promotion/event/match; placement inherits → Tasks 1–4 (columns) + services (stamping). ✓
- `weight_class`/`ruleset` as free text (design §3) → Task 3 schema (nullable text), Task 6 form (free inputs). ✓
- Derived record + submission-breakdown sanity query → Task 3 `athleteRecord` + test. ✓
- Event-centric admin flow (promotion → event → hub with inline match/placement, athlete typeahead + duplicate gate reusing A.1) → Tasks 5–6. ✓
- Hermetic pglite tests, `tsc --noEmit` clean → every task's tests; Task 4 Step 10 and Task 6 Step 9 run the full suite + typecheck. ✓
- **Correctly deferred (design §1):** Team + temporal membership, Video/Instructional, `change_log`/`created_by`/`updated_by` audit, formal enum/lookup tables, public pages. Named for later, not gaps.

**Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands with expected output. ✓

**Type consistency:** `Db` (A.1) consumed by every service signature; `CreatePromotionInput`/`CreateEventInput`/`CreateMatchInput`/`MatchCompetitorInput`/`AddPlacementInput` field names match their Zod schemas (`CreatePromotionSchema`/`CreateEventSchema`/`CreateMatchSchema`/`AddPlacementSchema`); enum value sets are identical between schema columns, service input types, and Zod enums (`match_type`, `outcome`, `method`); `getEvent`/`listMatchesForEvent`/`listPlacementsForEvent`/`athleteRecord` names match between producing tasks (2/3/4) and the consuming hub page (Task 6); `AthletePicker` `onPick` shape `{ id, name }` matches its consumers in `MatchForm`/`PlacementForm`. ✓

---

## Inherited / deferred follow-ups (not this plan)

- **Server-enforced duplicate gate (inherited from A.1 final review, Important).** The
  athlete duplicate-check gate reused by `AthletePicker` is UI-only; `POST
  /api/admin/athletes` does not re-check server-side, so a direct API caller can still
  create duplicate athletes. Applies equally to inline competitor creation here. Add a
  server guard (route/service requires an explicit `overrideDuplicates` flag when
  candidates exist). Track alongside the A.1 deferred item.
- **Admin authentication (inherited, Important).** No auth on `/admin/*` or `/api/admin/*`.
  Must land before any shared deployment (Phase B blocker).
- **Route-handler integration tests (inherited, Important).** Route tests cover the Zod
  schemas only; the POST/GET 201/400 contract is untested because handlers import the `db`
  singleton. Refactor to inject `db` and add pglite-backed handler tests — apply the same
  fix to A.1 and A.2 routes together.
- **`updatedAt` auto-bump** on all new tables (same gap as A.1) — add a DB trigger or
  service-level touch when edit paths land.
- **Formal `weight_class` / `ruleset` lookup tables / enums** — harden once the real spread
  is visible in entered data (design §3).

## Follow-on plans (not this plan)

- **Phase A.3** — Team + temporal `AthleteTeamMembership`; `change_log` audit table +
  `created_by`/`updated_by`; edit/update paths for existing entities.
- **Phase B** — public server-rendered pages (athlete/match/event/promotion) + Postgres FTS
  search + video/instructional secondary layer, consuming `athleteRecord` and the read
  helpers built here.
