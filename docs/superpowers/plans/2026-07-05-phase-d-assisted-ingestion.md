# Phase D v1 — Assisted Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let editors paste raw text, have Claude extract structured BJJ records, review/edit them in admin, and commit them into the existing entity tables as drafts.

**Architecture:** A staging layer (`ingestion_batches` + `ingestion_candidates`) holds AI-extracted candidates between extraction and approval. Extraction is behind a mockable `Extractor` interface (real impl calls the Anthropic API with structured outputs; tests inject a fake). Commit maps within-batch `localRef`s to real IDs and writes rows via the existing `create*` services as `status: draft, confidence: NEEDS_REVIEW`.

**Tech Stack:** Next.js 15 (App Router), Drizzle ORM + Postgres (pglite in tests), Zod v4, `@anthropic-ai/sdk`, Vitest.

## Global Constraints

- **Public/entity pages render only `published` rows.** Ingested rows commit as `status: "draft"`, `confidence: "NEEDS_REVIEW"` — ingestion never publishes.
- **Services take a `Db` param** (`db` or a transaction `tx`) as their first argument — never import the singleton inside a service. Only route handlers use the `db` singleton from `@/db/client`.
- **Tests use pglite** via `createTestDb()` (`@/db/test-db`) which migrates from `./drizzle`. Any new table requires a generated migration committed under `./drizzle`.
- **Model id** comes from `process.env.INGEST_MODEL`, default `claude-opus-4-8`. Never construct a dated-snapshot id.
- **Path alias:** import app code via `@/...` (e.g. `@/db/client`). `tsc --noEmit` and `next build` must pass; `noUncheckedIndexedAccess` is on, so guard array/`[0]` access.
- **Enums must match the DB exactly** — matchType `BRACKET|SUPERFIGHT|TRIAL|ALTERNATE`; method `SUBMISSION|POINTS|DECISION|DQ|OVERTIME|FORFEIT|NC|DRAW`; outcome `WON|LOST|DRAW|NC|DQ`; confidence `CONFIRMED|NEEDS_REVIEW`; status `draft|published`.

---

### Task 1: Ingestion staging schema + migration + SDK dependency

**Files:**
- Create: `src/db/schema/ingestion.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk` dependency)
- Generated: `drizzle/*` (via `npm run db:generate`)
- Test: `src/db/schema/ingestion.test.ts`

**Interfaces:**
- Produces: tables `ingestionBatches`, `ingestionCandidates`; types `IngestionBatch`, `NewIngestionBatch`, `IngestionCandidate`, `NewIngestionCandidate`. Batch `status` enum `extracting|review|committed|failed`; candidate `entityType` enum `athlete|promotion|event|match`; candidate `decision` enum `pending|accept|merge|reject`.

- [ ] **Step 1: Write the schema file**

Create `src/db/schema/ingestion.ts`:

```ts
import {
  pgTable, uuid, text, real, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";

export const ingestionBatches = pgTable("ingestion_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceText: text("source_text").notNull(),
  sourceNote: text("source_note"),
  createdBy: text("created_by"),
  status: text("status", {
    enum: ["extracting", "review", "committed", "failed"],
  })
    .notNull()
    .default("extracting"),
  model: text("model"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ingestionCandidates = pgTable(
  "ingestion_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestionBatches.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: ["athlete", "promotion", "event", "match"],
    }).notNull(),
    payload: jsonb("payload").notNull(),
    localRef: text("local_ref").notNull(),
    resolvedEntityId: uuid("resolved_entity_id"),
    resolvedEntityType: text("resolved_entity_type"),
    matchScore: real("match_score"),
    decision: text("decision", {
      enum: ["pending", "accept", "merge", "reject"],
    })
      .notNull()
      .default("pending"),
    committedEntityId: uuid("committed_entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ingestion_candidates_batch_id_idx").on(t.batchId)],
);

export type IngestionBatch = typeof ingestionBatches.$inferSelect;
export type NewIngestionBatch = typeof ingestionBatches.$inferInsert;
export type IngestionCandidate = typeof ingestionCandidates.$inferSelect;
export type NewIngestionCandidate = typeof ingestionCandidates.$inferInsert;
```

- [ ] **Step 2: Register the tables**

Add to `src/db/schema/index.ts` (after the existing exports):

```ts
export * from "./ingestion";
```

- [ ] **Step 3: Install the Anthropic SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: `package.json` gains `@anthropic-ai/sdk` under `dependencies`; no errors.

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new SQL file appears under `drizzle/` creating `ingestion_batches` and `ingestion_candidates`. No DB connection is needed for generate.

- [ ] **Step 5: Write the failing test**

Create `src/db/schema/ingestion.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { ingestionBatches, ingestionCandidates } from "@/db/schema/ingestion";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("ingestion schema", () => {
  it("inserts a batch and a candidate and reads them back", async () => {
    const [batch] = await ctx.db
      .insert(ingestionBatches)
      .values({ sourceText: "some pasted text" })
      .returning();
    expect(batch?.status).toBe("extracting");

    const [cand] = await ctx.db
      .insert(ingestionCandidates)
      .values({
        batchId: batch!.id,
        entityType: "athlete",
        payload: { fullName: "Gordon Ryan" },
        localRef: "a1",
      })
      .returning();
    expect(cand?.decision).toBe("pending");

    const rows = await ctx.db
      .select()
      .from(ingestionCandidates)
      .where(eq(ingestionCandidates.batchId, batch!.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { fullName: string }).fullName).toBe("Gordon Ryan");
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/db/schema/ingestion.test.ts`
Expected: PASS (the migration created the tables in pglite).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/ingestion.ts src/db/schema/index.ts package.json package-lock.json drizzle src/db/schema/ingestion.test.ts
git commit -m "feat(ingest): staging schema for ingestion batches + candidates"
```

---

### Task 2: Extraction Zod schemas (candidate graph)

**Files:**
- Create: `src/lib/ingestion/schema.ts`
- Test: `src/lib/ingestion/schema.test.ts`

**Interfaces:**
- Produces: `ExtractionSchema` (Zod object) and types `CandidateGraph`, `AthleteCandidate`, `PromotionCandidate`, `EventCandidate`, `MatchCandidate`. A match references its event via `eventRef` and each competitor via `athleteRef`; an event references its promotion via `promotionRef`; every candidate carries a `localRef`.

- [ ] **Step 1: Write the schema file**

Create `src/lib/ingestion/schema.ts`:

```ts
import { z } from "zod";

export const AthleteCandidateSchema = z.object({
  localRef: z.string().min(1),
  fullName: z.string().min(1),
  nationality: z.string().nullable().optional(),
  aliases: z.array(z.string().min(1)).optional(),
});

export const PromotionCandidateSchema = z.object({
  localRef: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
});

export const EventCandidateSchema = z.object({
  localRef: z.string().min(1),
  promotionRef: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string().min(1), // YYYY-MM-DD
  endDate: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});

export const MatchCompetitorCandidateSchema = z.object({
  athleteRef: z.string().min(1),
  outcome: z.enum(["WON", "LOST", "DRAW", "NC", "DQ"]),
  slotOrder: z.number().int().nullable().optional(),
});

export const MatchCandidateSchema = z.object({
  localRef: z.string().min(1),
  eventRef: z.string().min(1),
  matchType: z.enum(["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"]),
  round: z.string().nullable().optional(),
  weightClass: z.string().nullable().optional(),
  ruleset: z.string().nullable().optional(),
  method: z.enum([
    "SUBMISSION", "POINTS", "DECISION", "DQ",
    "OVERTIME", "FORFEIT", "NC", "DRAW",
  ]),
  methodDetail: z.string().nullable().optional(),
  durationSeconds: z.number().int().nullable().optional(),
  competitors: z.array(MatchCompetitorCandidateSchema),
});

export const ExtractionSchema = z.object({
  athletes: z.array(AthleteCandidateSchema),
  promotions: z.array(PromotionCandidateSchema),
  events: z.array(EventCandidateSchema),
  matches: z.array(MatchCandidateSchema),
});

export type CandidateGraph = z.infer<typeof ExtractionSchema>;
export type AthleteCandidate = z.infer<typeof AthleteCandidateSchema>;
export type PromotionCandidate = z.infer<typeof PromotionCandidateSchema>;
export type EventCandidate = z.infer<typeof EventCandidateSchema>;
export type MatchCandidate = z.infer<typeof MatchCandidateSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/ingestion/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ExtractionSchema } from "@/lib/ingestion/schema";

const sample = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan", aliases: ["The King"] },
    { localRef: "a2", fullName: "Andre Galvao" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC", shortName: "ADCC" }],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [
    {
      localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
      competitors: [
        { athleteRef: "a1", outcome: "WON", slotOrder: 1 },
        { athleteRef: "a2", outcome: "LOST", slotOrder: 2 },
      ],
    },
  ],
};

describe("ExtractionSchema", () => {
  it("parses a valid candidate graph with refs", () => {
    const parsed = ExtractionSchema.parse(sample);
    expect(parsed.matches[0]?.competitors[0]?.athleteRef).toBe("a1");
    expect(parsed.events[0]?.promotionRef).toBe("p1");
  });

  it("rejects a match with an invalid method", () => {
    const bad = structuredClone(sample);
    // @ts-expect-error deliberately invalid enum
    bad.matches[0].method = "KIMURA";
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a candidate missing localRef", () => {
    const bad = structuredClone(sample);
    // @ts-expect-error deliberately missing required field
    delete bad.athletes[0].localRef;
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/schema.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ingestion/schema.ts src/lib/ingestion/schema.test.ts
git commit -m "feat(ingest): Zod extraction schema for candidate graph"
```

---

### Task 3: Extractor interface + fake + Claude implementation

**Files:**
- Create: `src/lib/ingestion/extract.ts`
- Modify: `.env.example` (add `ANTHROPIC_API_KEY`, `INGEST_MODEL`)
- Test: `src/lib/ingestion/extract.test.ts`

**Interfaces:**
- Consumes: `ExtractionSchema`, `CandidateGraph` from Task 2.
- Produces: `interface Extractor { extract(text: string): Promise<CandidateGraph> }`; `class FakeExtractor implements Extractor` (constructed with a preset `CandidateGraph`); `class ClaudeExtractor implements Extractor`; `EXTRACTION_SYSTEM_PROMPT` string.

- [ ] **Step 1: Write the extractor file**

Create `src/lib/ingestion/extract.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ExtractionSchema, type CandidateGraph } from "@/lib/ingestion/schema";

export interface Extractor {
  extract(text: string): Promise<CandidateGraph>;
}

/** Test double: returns a preset graph, ignoring the input text. */
export class FakeExtractor implements Extractor {
  constructor(private readonly graph: CandidateGraph) {}
  async extract(): Promise<CandidateGraph> {
    return this.graph;
  }
}

export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured BJJ / no-gi grappling records from pasted text.",
  "Return athletes, promotions, events, and matches you can find.",
  "Give every entity a short unique localRef (e.g. a1, p1, e1, m1).",
  "Matches reference their event via eventRef and each competitor via athleteRef;",
  "events reference their promotion via promotionRef — always use the localRefs",
  "of entities you also returned. Dates are YYYY-MM-DD. Only include facts present",
  "in the text; do not invent competitors, methods, or dates.",
].join(" ");

/**
 * Real extractor. Uses structured outputs so the model returns schema-valid JSON.
 * Reads ANTHROPIC_API_KEY from the environment (see .env.local). Model id from
 * INGEST_MODEL, default claude-opus-4-8.
 */
export class ClaudeExtractor implements Extractor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
    this.model = process.env.INGEST_MODEL ?? "claude-opus-4-8";
  }

  async extract(text: string): Promise<CandidateGraph> {
    // z.toJSONSchema (Zod v4) yields a JSON Schema with additionalProperties:false,
    // which structured outputs requires.
    const schema = z.toJSONSchema(ExtractionSchema);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: EXTRACTION_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: text }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("ClaudeExtractor: no text block in response");
    }
    return ExtractionSchema.parse(JSON.parse(block.text));
  }
}
```

Note: `output_config` may not yet be in the installed SDK's params type — the `as Anthropic.MessageCreateParamsNonStreaming` cast keeps `tsc` green while sending the field. If `z.toJSONSchema` is unavailable in the installed Zod, fall back to a hand-written JSON schema literal (same shape as `ExtractionSchema`) — but Zod ^4.4 provides it.

- [ ] **Step 2: Add env-example entries**

Append to `.env.example`:

```
# Anthropic API key for assisted ingestion (Phase D). Required only to run live
# extraction; the review/commit pipeline works without it.
ANTHROPIC_API_KEY=sk-ant-...
# Optional override for the extraction model (default claude-opus-4-8).
INGEST_MODEL=claude-opus-4-8
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/ingestion/extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeExtractor, type Extractor } from "@/lib/ingestion/extract";
import { ExtractionSchema, type CandidateGraph } from "@/lib/ingestion/schema";

const graph: CandidateGraph = {
  athletes: [{ localRef: "a1", fullName: "Gordon Ryan" }],
  promotions: [{ localRef: "p1", name: "ADCC" }],
  events: [{ localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" }],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [{ athleteRef: "a1", outcome: "WON" }],
  }],
};

describe("FakeExtractor", () => {
  it("returns the preset graph and satisfies the Extractor interface", async () => {
    const extractor: Extractor = new FakeExtractor(graph);
    const out = await extractor.extract("ignored text");
    expect(ExtractionSchema.parse(out)).toEqual(graph);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (the ClaudeExtractor path is compile-checked, not run)**

Run: `npx tsc --noEmit`
Expected: exit 0. If `output_config` triggers an error despite the cast, widen the cast to `as unknown as Anthropic.MessageCreateParamsNonStreaming`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingestion/extract.ts src/lib/ingestion/extract.test.ts .env.example
git commit -m "feat(ingest): Extractor interface with fake + Claude structured-output impl"
```

---

### Task 4: Entity-resolution proposals

**Files:**
- Create: `src/lib/ingestion/resolve.ts`
- Test: `src/lib/ingestion/resolve.test.ts`

**Interfaces:**
- Consumes: `CandidateGraph` (Task 2); `findAthleteDuplicates` from `@/lib/athletes/service`; `normalizeName` from `@/lib/identity/normalize`; `Db` from `@/db/client`.
- Produces: type `ResolvedCandidate = { entityType: "athlete"|"promotion"|"event"|"match"; localRef: string; payload: unknown; resolvedEntityId: string | null; resolvedEntityType: string | null; matchScore: number | null }`; `async function resolveCandidates(db: Db, graph: CandidateGraph): Promise<ResolvedCandidate[]>`.

- [ ] **Step 1: Write the resolver**

Create `src/lib/ingestion/resolve.ts`:

```ts
import type { Db } from "@/db/client";
import { promotions } from "@/db/schema/promotion";
import { events } from "@/db/schema/event";
import { findAthleteDuplicates } from "@/lib/athletes/service";
import { normalizeName } from "@/lib/identity/normalize";
import type { CandidateGraph } from "@/lib/ingestion/schema";

export type ResolvedCandidate = {
  entityType: "athlete" | "promotion" | "event" | "match";
  localRef: string;
  payload: unknown;
  resolvedEntityId: string | null;
  resolvedEntityType: string | null;
  matchScore: number | null;
};

export async function resolveCandidates(
  db: Db,
  graph: CandidateGraph,
): Promise<ResolvedCandidate[]> {
  const out: ResolvedCandidate[] = [];

  // Athletes: fuzzy name/alias match against existing athletes.
  for (const a of graph.athletes) {
    const dups = await findAthleteDuplicates(db, a.fullName);
    const best = dups[0];
    out.push({
      entityType: "athlete",
      localRef: a.localRef,
      payload: a,
      resolvedEntityId: best?.id ?? null,
      resolvedEntityType: best ? "athlete" : null,
      matchScore: best?.score ?? null,
    });
  }

  // Promotions: exact normalized-name match.
  const promoRows = await db
    .select({ id: promotions.id, name: promotions.name })
    .from(promotions);
  for (const p of graph.promotions) {
    const target = normalizeName(p.name);
    const hit = promoRows.find((r) => normalizeName(r.name) === target);
    out.push({
      entityType: "promotion",
      localRef: p.localRef,
      payload: p,
      resolvedEntityId: hit?.id ?? null,
      resolvedEntityType: hit ? "promotion" : null,
      matchScore: hit ? 1 : null,
    });
  }

  // Events: exact normalized-name match.
  const eventRows = await db
    .select({ id: events.id, name: events.name })
    .from(events);
  for (const e of graph.events) {
    const target = normalizeName(e.name);
    const hit = eventRows.find((r) => normalizeName(r.name) === target);
    out.push({
      entityType: "event",
      localRef: e.localRef,
      payload: e,
      resolvedEntityId: hit?.id ?? null,
      resolvedEntityType: hit ? "event" : null,
      matchScore: hit ? 1 : null,
    });
  }

  // Matches: no resolution proposal in v1.
  for (const m of graph.matches) {
    out.push({
      entityType: "match",
      localRef: m.localRef,
      payload: m,
      resolvedEntityId: null,
      resolvedEntityType: null,
      matchScore: null,
    });
  }

  return out;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/ingestion/resolve.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { resolveCandidates } from "@/lib/ingestion/resolve";
import type { CandidateGraph } from "@/lib/ingestion/schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const graph: CandidateGraph = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan" },
    { localRef: "a2", fullName: "Totally New Person" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC" }],
  events: [],
  matches: [],
};

describe("resolveCandidates", () => {
  it("proposes existing athletes/promotions and leaves genuinely new ones unresolved", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    await createPromotion(ctx.db, { name: "ADCC" });

    const resolved = await resolveCandidates(ctx.db, graph);
    const gordon = resolved.find((r) => r.localRef === "a1")!;
    const newbie = resolved.find((r) => r.localRef === "a2")!;
    const adcc = resolved.find((r) => r.localRef === "p1")!;

    expect(gordon.resolvedEntityId).not.toBeNull();
    expect(gordon.matchScore!).toBeGreaterThanOrEqual(0.82);
    expect(newbie.resolvedEntityId).toBeNull();
    expect(adcc.resolvedEntityId).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/resolve.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ingestion/resolve.ts src/lib/ingestion/resolve.test.ts
git commit -m "feat(ingest): entity-resolution proposals for candidates"
```

---

### Task 5: Ingestion service (create, extract, decide, commit)

**Files:**
- Create: `src/lib/ingestion/service.ts`
- Test: `src/lib/ingestion/service.test.ts`

**Interfaces:**
- Consumes: `Extractor` (Task 3); `resolveCandidates` (Task 4); the candidate types (Task 2); tables from Task 1; `createPromotion`, `createEvent`, `createAthlete`, `createMatch` from the existing services.
- Produces:
  - `createBatch(db, input: { sourceText: string; sourceNote?: string; createdBy?: string }): Promise<IngestionBatch>`
  - `runExtraction(db, extractor: Extractor, batchId: string): Promise<void>`
  - `getBatch(db, batchId): Promise<{ batch: IngestionBatch; candidates: IngestionCandidate[] } | null>`
  - `setDecision(db, candidateId: string, decision: "pending"|"accept"|"merge"|"reject"): Promise<void>`
  - `commitBatch(db, batchId): Promise<{ promotions: number; events: number; athletes: number; matches: number }>`

- [ ] **Step 1: Write the service**

Create `src/lib/ingestion/service.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  ingestionBatches, ingestionCandidates,
  type IngestionBatch, type IngestionCandidate,
} from "@/db/schema/ingestion";
import { resolveCandidates } from "@/lib/ingestion/resolve";
import type { Extractor } from "@/lib/ingestion/extract";
import type {
  AthleteCandidate, PromotionCandidate, EventCandidate, MatchCandidate,
} from "@/lib/ingestion/schema";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createAthlete } from "@/lib/athletes/service";
import { createMatch } from "@/lib/matches/service";

export async function createBatch(
  db: Db,
  input: { sourceText: string; sourceNote?: string; createdBy?: string },
): Promise<IngestionBatch> {
  const rows = await db
    .insert(ingestionBatches)
    .values({
      sourceText: input.sourceText,
      sourceNote: input.sourceNote ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  const batch = rows[0];
  if (!batch) throw new Error("createBatch: insert returned no rows");
  return batch;
}

export async function runExtraction(
  db: Db,
  extractor: Extractor,
  batchId: string,
): Promise<void> {
  const batch = (await db
    .select()
    .from(ingestionBatches)
    .where(eq(ingestionBatches.id, batchId)))[0];
  if (!batch) throw new Error(`runExtraction: batch ${batchId} not found`);

  try {
    const graph = await extractor.extract(batch.sourceText);
    const resolved = await resolveCandidates(db, graph);
    if (resolved.length) {
      await db.insert(ingestionCandidates).values(
        resolved.map((r) => ({
          batchId,
          entityType: r.entityType,
          payload: r.payload,
          localRef: r.localRef,
          resolvedEntityId: r.resolvedEntityId,
          resolvedEntityType: r.resolvedEntityType,
          matchScore: r.matchScore,
        })),
      );
    }
    await db
      .update(ingestionBatches)
      .set({ status: "review", model: process.env.INGEST_MODEL ?? "claude-opus-4-8" })
      .where(eq(ingestionBatches.id, batchId));
  } catch (err) {
    await db
      .update(ingestionBatches)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(ingestionBatches.id, batchId));
    throw err;
  }
}

export async function getBatch(
  db: Db,
  batchId: string,
): Promise<{ batch: IngestionBatch; candidates: IngestionCandidate[] } | null> {
  const batch = (await db
    .select()
    .from(ingestionBatches)
    .where(eq(ingestionBatches.id, batchId)))[0];
  if (!batch) return null;
  const candidates = await db
    .select()
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.batchId, batchId));
  return { batch, candidates };
}

export async function setDecision(
  db: Db,
  candidateId: string,
  decision: "pending" | "accept" | "merge" | "reject",
): Promise<void> {
  await db
    .update(ingestionCandidates)
    .set({ decision })
    .where(eq(ingestionCandidates.id, candidateId));
}

export async function commitBatch(
  db: Db,
  batchId: string,
): Promise<{ promotions: number; events: number; athletes: number; matches: number }> {
  const loaded = await getBatch(db, batchId);
  if (!loaded) throw new Error(`commitBatch: batch ${batchId} not found`);
  if (loaded.batch.status !== "review") {
    throw new Error(
      `commitBatch: batch ${batchId} is not in review (status=${loaded.batch.status})`,
    );
  }

  const { batch, candidates } = loaded;
  const provenance = {
    status: "draft" as const,
    confidence: "NEEDS_REVIEW" as const,
    verifiedBy: batch.createdBy ?? undefined,
    sourceUrl: batch.sourceNote ?? undefined,
  };

  const committable = (c: IngestionCandidate) =>
    c.decision === "accept" || c.decision === "merge";

  const byType = (t: IngestionCandidate["entityType"]) =>
    candidates.filter((c) => c.entityType === t && committable(c));

  // Pre-validate refs: every ref an accepted/merged entity depends on must
  // itself be committable, so no partial graph is written.
  const committableRefs = (t: IngestionCandidate["entityType"]) =>
    new Set(byType(t).map((c) => c.localRef));
  const promoRefs = committableRefs("promotion");
  const eventRefs = committableRefs("event");
  const athleteRefs = committableRefs("athlete");

  for (const c of byType("event")) {
    const p = c.payload as EventCandidate;
    if (!promoRefs.has(p.promotionRef)) {
      throw new Error(`commitBatch: event "${p.name}" references uncommitted promotion ref ${p.promotionRef}`);
    }
  }
  for (const c of byType("match")) {
    const m = c.payload as MatchCandidate;
    if (!eventRefs.has(m.eventRef)) {
      throw new Error(`commitBatch: match ${m.localRef} references uncommitted event ref ${m.eventRef}`);
    }
    for (const comp of m.competitors) {
      if (!athleteRefs.has(comp.athleteRef)) {
        throw new Error(`commitBatch: match ${m.localRef} references uncommitted athlete ref ${comp.athleteRef}`);
      }
    }
  }

  const counts = { promotions: 0, events: 0, athletes: 0, matches: 0 };
  const promoMap = new Map<string, string>();
  const eventMap = new Map<string, string>();
  const athleteMap = new Map<string, string>();

  await db.transaction(async (tx) => {
    const commitId = async (
      c: IngestionCandidate,
      make: () => Promise<string>,
    ): Promise<string> => {
      const id = c.decision === "merge" && c.resolvedEntityId
        ? c.resolvedEntityId
        : await make();
      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: id })
        .where(eq(ingestionCandidates.id, c.id));
      return id;
    };

    for (const c of byType("promotion")) {
      const p = c.payload as PromotionCandidate;
      const id = await commitId(c, async () =>
        (await createPromotion(tx, {
          name: p.name,
          shortName: p.shortName ?? undefined,
          ...provenance,
        })).id,
      );
      promoMap.set(c.localRef, id);
      counts.promotions += 1;
    }

    for (const c of byType("event")) {
      const e = c.payload as EventCandidate;
      const id = await commitId(c, async () =>
        (await createEvent(tx, {
          promotionId: promoMap.get(e.promotionRef)!,
          name: e.name,
          startDate: e.startDate,
          endDate: e.endDate ?? undefined,
          venue: e.venue ?? undefined,
          location: e.location ?? undefined,
          ...provenance,
        })).id,
      );
      eventMap.set(c.localRef, id);
      counts.events += 1;
    }

    for (const c of byType("athlete")) {
      const a = c.payload as AthleteCandidate;
      const id = await commitId(c, async () =>
        (await createAthlete(tx, {
          fullName: a.fullName,
          nationality: a.nationality ?? undefined,
          aliases: a.aliases,
          ...provenance,
        })).id,
      );
      athleteMap.set(c.localRef, id);
      counts.athletes += 1;
    }

    for (const c of byType("match")) {
      const m = c.payload as MatchCandidate;
      const created = await createMatch(tx, {
        eventId: eventMap.get(m.eventRef)!,
        matchType: m.matchType,
        round: m.round ?? undefined,
        weightClass: m.weightClass ?? undefined,
        ruleset: m.ruleset ?? undefined,
        method: m.method,
        methodDetail: m.methodDetail ?? undefined,
        durationSeconds: m.durationSeconds ?? undefined,
        competitors: m.competitors.map((comp) => ({
          athleteId: athleteMap.get(comp.athleteRef)!,
          outcome: comp.outcome,
          slotOrder: comp.slotOrder ?? undefined,
        })),
        ...provenance,
      });
      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: created.id })
        .where(eq(ingestionCandidates.id, c.id));
      counts.matches += 1;
    }

    await tx
      .update(ingestionBatches)
      .set({ status: "committed" })
      .where(eq(ingestionBatches.id, batchId));
  });

  return counts;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/ingestion/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { FakeExtractor } from "@/lib/ingestion/extract";
import type { CandidateGraph } from "@/lib/ingestion/schema";
import {
  createBatch, runExtraction, getBatch, setDecision, commitBatch,
} from "@/lib/ingestion/service";
import { athletes } from "@/db/schema/athlete";
import { matches, matchCompetitors } from "@/db/schema/match";
import { createAthlete } from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const graph: CandidateGraph = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan" },
    { localRef: "a2", fullName: "Andre Galvao" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC", shortName: "ADCC" }],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [
      { athleteRef: "a1", outcome: "WON", slotOrder: 1 },
      { athleteRef: "a2", outcome: "LOST", slotOrder: 2 },
    ],
  }],
};

async function extractAll() {
  const batch = await createBatch(ctx.db, { sourceText: "raw", createdBy: "editor@x" });
  await runExtraction(ctx.db, new FakeExtractor(graph), batch.id);
  return batch;
}

async function acceptAll(batchId: string) {
  const loaded = (await getBatch(ctx.db, batchId))!;
  for (const c of loaded.candidates) await setDecision(ctx.db, c.id, "accept");
}

describe("ingestion service", () => {
  it("runExtraction persists candidates and moves the batch to review", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    expect(loaded.batch.status).toBe("review");
    expect(loaded.candidates).toHaveLength(5); // 2 athletes, 1 promo, 1 event, 1 match
  });

  it("commitBatch writes draft/NEEDS_REVIEW rows and links match competitors", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts).toEqual({ promotions: 1, events: 1, athletes: 2, matches: 1 });

    const athleteRows = await ctx.db.select().from(athletes);
    expect(athleteRows).toHaveLength(2);
    expect(athleteRows.every((a) => a.status === "draft" && a.confidence === "NEEDS_REVIEW")).toBe(true);

    const matchRows = await ctx.db.select().from(matches);
    expect(matchRows).toHaveLength(1);
    const comps = await ctx.db
      .select()
      .from(matchCompetitors)
      .where(eq(matchCompetitors.matchId, matchRows[0]!.id));
    expect(comps).toHaveLength(2);

    const after = (await getBatch(ctx.db, batch.id))!;
    expect(after.batch.status).toBe("committed");
    expect(after.candidates.every((c) => c.committedEntityId !== null)).toBe(true);
  });

  it("merge reuses the existing entity instead of creating a new one", async () => {
    const existing = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isGordon = c.entityType === "athlete" && (c.payload as { fullName: string }).fullName === "Gordon Ryan";
      await setDecision(ctx.db, c.id, isGordon ? "merge" : "accept");
    }
    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts.athletes).toBe(1); // only Galvao created; Gordon merged

    const athleteRows = await ctx.db.select().from(athletes);
    expect(athleteRows).toHaveLength(2); // existing Gordon + new Galvao
    const comps = await ctx.db.select().from(matchCompetitors);
    expect(comps.some((c) => c.athleteId === existing.id)).toBe(true);
  });

  it("rejects the commit when a match references a rejected athlete", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isGalvao = c.entityType === "athlete" && (c.payload as { fullName: string }).fullName === "Andre Galvao";
      await setDecision(ctx.db, c.id, isGalvao ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/uncommitted athlete ref/);
  });

  it("refuses to commit a batch that is not in review", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/not in review/);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/service.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/service.ts src/lib/ingestion/service.test.ts
git commit -m "feat(ingest): batch service — create, extract, decide, commit"
```

---

### Task 6: API routes + request validation

**Files:**
- Create: `src/app/api/admin/ingest/validation.ts`
- Create: `src/app/api/admin/ingest/route.ts`
- Create: `src/app/api/admin/ingest/[id]/route.ts`
- Create: `src/app/api/admin/ingest/[id]/commit/route.ts`
- Test: `src/app/api/admin/ingest/validation.test.ts`

**Interfaces:**
- Consumes: service functions (Task 5); `ClaudeExtractor` (Task 3); `db` singleton from `@/db/client`.
- Produces: Zod `IngestSchema` (`{ sourceText: string; sourceNote?: string }`) and `DecisionSchema` (`{ candidateId: string; decision: enum }`); the route handlers.

- [ ] **Step 1: Write the validation schemas**

Create `src/app/api/admin/ingest/validation.ts`:

```ts
import { z } from "zod";

export const IngestSchema = z.object({
  sourceText: z.string().min(1),
  sourceNote: z.string().optional(),
});

export const DecisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["pending", "accept", "merge", "reject"]),
});
```

- [ ] **Step 2: Write the create+extract route**

Create `src/app/api/admin/ingest/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createBatch, runExtraction, getBatch } from "@/lib/ingestion/service";
import { ClaudeExtractor } from "@/lib/ingestion/extract";
import { IngestSchema } from "./validation";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = IngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const batch = await createBatch(db, parsed.data);
  try {
    await runExtraction(db, new ClaudeExtractor(), batch.id);
  } catch {
    // Batch is marked failed inside runExtraction; return it so the UI can show the error.
    return NextResponse.json(await getBatch(db, batch.id), { status: 502 });
  }
  return NextResponse.json(await getBatch(db, batch.id), { status: 201 });
}
```

- [ ] **Step 3: Write the get + decision route**

Create `src/app/api/admin/ingest/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { getBatch, setDecision } from "@/lib/ingestion/service";
import { DecisionSchema } from "../validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await getBatch(db, id);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(loaded);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // batch id is implied by the candidate id
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await setDecision(db, parsed.data.candidateId, parsed.data.decision);
  return NextResponse.json({ ok: true });
}
```

Note: Next.js 15 route handler `params` is a `Promise` — `await` it (matches the existing `[id]` admin routes).

- [ ] **Step 4: Write the commit route**

Create `src/app/api/admin/ingest/[id]/commit/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { commitBatch } from "@/lib/ingestion/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const counts = await commitBatch(db, id);
    return NextResponse.json(counts);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "commit failed" },
      { status: 409 },
    );
  }
}
```

- [ ] **Step 5: Write the failing validation test**

Create `src/app/api/admin/ingest/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IngestSchema, DecisionSchema } from "./validation";

describe("ingest validation", () => {
  it("accepts a paste with text and rejects empty text", () => {
    expect(IngestSchema.safeParse({ sourceText: "hi" }).success).toBe(true);
    expect(IngestSchema.safeParse({ sourceText: "" }).success).toBe(false);
  });

  it("validates a decision payload", () => {
    expect(DecisionSchema.safeParse({
      candidateId: "00000000-0000-0000-0000-000000000000", decision: "accept",
    }).success).toBe(true);
    expect(DecisionSchema.safeParse({ candidateId: "x", decision: "accept" }).success).toBe(false);
    expect(DecisionSchema.safeParse({
      candidateId: "00000000-0000-0000-0000-000000000000", decision: "publish",
    }).success).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/app/api/admin/ingest/validation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/ingest
git commit -m "feat(ingest): API routes for create/extract, decisions, and commit"
```

---

### Task 7: Admin UI — paste form + review queue

**Files:**
- Create: `src/app/admin/ingest/page.tsx` (server; renders the paste form)
- Create: `src/app/admin/ingest/ingest-form.tsx` (client)
- Create: `src/app/admin/ingest/[id]/page.tsx` (server; loads batch + candidates)
- Create: `src/app/admin/ingest/[id]/review.tsx` (client; per-candidate decisions + commit)

**Interfaces:**
- Consumes: the API routes (Task 6); `getBatch` (Task 5) for the server-rendered review page.

- [ ] **Step 1: Write the paste page (server component)**

Create `src/app/admin/ingest/page.tsx`:

```tsx
import { IngestForm } from "./ingest-form";

export default function IngestPage() {
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Assisted ingestion</h1>
      <p>Paste event results, an article, or a bracket. Claude extracts records to review.</p>
      <IngestForm />
    </main>
  );
}
```

- [ ] **Step 2: Write the paste form (client component)**

Create `src/app/admin/ingest/ingest-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function IngestForm() {
  const router = useRouter();
  const [sourceText, setSourceText] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceText.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceText, sourceNote: sourceNote || undefined }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data?.batch?.error ?? "Extraction failed");
      return;
    }
    router.push(`/admin/ingest/${data.batch.id}`);
  }

  return (
    <form onSubmit={submit}>
      <label style={{ display: "block", margin: "8px 0" }}>
        Source note (optional)
        <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        Pasted text
        <textarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          rows={16}
          style={{ width: "100%" }}
        />
      </label>
      <button type="submit" disabled={busy || !sourceText.trim()}>
        {busy ? "Extracting…" : "Extract"}
      </button>
      {error && <p style={{ color: "#c00" }}>{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Write the review page (server component)**

Create `src/app/admin/ingest/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getBatch } from "@/lib/ingestion/service";
import { ReviewQueue } from "./review";

export default async function ReviewPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await getBatch(db, id);
  if (!loaded) notFound();

  return (
    <main style={{ maxWidth: 860, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Review batch</h1>
      <p>Status: {loaded.batch.status}{loaded.batch.error ? ` — ${loaded.batch.error}` : ""}</p>
      <ReviewQueue batchId={id} candidates={loaded.candidates} committed={loaded.batch.status === "committed"} />
    </main>
  );
}
```

- [ ] **Step 4: Write the review queue (client component)**

Create `src/app/admin/ingest/[id]/review.tsx`:

```tsx
"use client";
import { useState } from "react";

type Candidate = {
  id: string;
  entityType: string;
  localRef: string;
  payload: unknown;
  resolvedEntityId: string | null;
  matchScore: number | null;
  decision: string;
  committedEntityId: string | null;
};

export function ReviewQueue(
  { batchId, candidates, committed }: { batchId: string; candidates: Candidate[]; committed: boolean },
) {
  const [rows, setRows] = useState(candidates);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(candidateId: string, decision: string) {
    await fetch(`/api/admin/ingest/${batchId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId, decision }),
    });
    setRows((rs) => rs.map((r) => (r.id === candidateId ? { ...r, decision } : r)));
  }

  async function commit() {
    const res = await fetch(`/api/admin/ingest/${batchId}/commit`, { method: "POST" });
    const data = await res.json();
    setMessage(res.ok
      ? `Committed: ${data.promotions} promotions, ${data.events} events, ${data.athletes} athletes, ${data.matches} matches (as drafts).`
      : `Commit failed: ${data.error}`);
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th align="left">Type</th><th align="left">Summary</th><th align="left">Resolved?</th><th align="left">Decision</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #ddd" }}>
              <td>{r.entityType}</td>
              <td><code>{JSON.stringify(r.payload)}</code></td>
              <td>{r.resolvedEntityId ? `yes (${r.matchScore?.toFixed(2) ?? ""})` : "—"}</td>
              <td>
                {committed ? r.decision : (
                  <>
                    {(["accept", "merge", "reject"] as const).map((d) => (
                      <button
                        key={d}
                        disabled={d === "merge" && !r.resolvedEntityId}
                        onClick={() => decide(r.id, d)}
                        style={{ fontWeight: r.decision === d ? "bold" : "normal", marginRight: 4 }}
                      >
                        {d}
                      </button>
                    ))}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!committed && <button onClick={commit} style={{ marginTop: 12 }}>Commit batch</button>}
      {message && <p>{message}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds; the route list includes `/admin/ingest` and `/admin/ingest/[id]`.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/ingest
git commit -m "feat(ingest): admin paste form + review queue UI"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (existing suite + the new ingestion tests).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: (Optional, needs a key) live smoke test**

With `ANTHROPIC_API_KEY` in `.env.local` and the docker Postgres running (`docker compose up -d`, `npm run db:migrate`, `npm run dev`): open `/admin/ingest`, paste a short event result, confirm candidates appear in the review queue, accept them, commit, and verify draft rows exist (they will not appear on public pages until published).

- [ ] **Step 5: Commit (if any verification-driven fixes were made)**

```bash
git add -A
git commit -m "chore(ingest): phase D v1 verification"
```

---

## Self-Review notes

- **Spec coverage:** staging tables (Task 1), extraction schemas (Task 2), mockable Extractor + Claude structured-output impl (Task 3), resolution reusing `findDuplicateCandidates`/`normalizeName` (Task 4), service with localRef→id mapping + draft/NEEDS_REVIEW commit + non-idempotent guard (Task 5), API routes (Task 6), paste + review UI (Task 7), verification (Task 8). Publish gate honored (commit is always `draft`/`NEEDS_REVIEW`; no publish action). Deferred items (URL fetch, teams/placements/videos, bulk CSV, auto-publish) are out of scope per the spec.
- **Type consistency:** `ResolvedCandidate` (Task 4) feeds the candidate-row insert in Task 5; `CandidateGraph`/`*Candidate` types (Task 2) are consumed by Tasks 3–5; enums match the DB (Global Constraints). `getBatch`/`setDecision`/`commitBatch` signatures used in Tasks 6–7 match Task 5.
- **Error paths:** extraction failure → batch `failed` (Task 5, surfaced by Task 6 502 + Task 7 error text); commit ref-validation and non-idempotent guards throw (Task 5), surfaced by Task 6 409.
