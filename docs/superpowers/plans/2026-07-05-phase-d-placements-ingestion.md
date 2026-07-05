# Placements Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Phase D freeform extraction so a pasted results article also yields **placements** (an athlete placing Nth in a division at an event), committed as `NEEDS_REVIEW` drafts through the existing ingest review → commit pipeline.

**Architecture:** Placements are edges in the candidate graph (like matches): they reference an `eventRef` + `athleteRef` and get no resolution proposal in v1. The slice mirrors the existing promotion → event → athlete → match pipeline: extend the extraction schema, emit placement candidates in resolve, and commit them via the existing `addPlacement` service after athletes, with ref pre-validation and a unique-constraint dedup guard.

**Tech Stack:** TypeScript, Next.js 15, Drizzle ORM, Zod v4, Vitest + pglite, Anthropic SDK (stubbed in tests via `FakeExtractor`).

## Global Constraints

- Ingest never publishes: committed rows are `status: draft` / `confidence: NEEDS_REVIEW`. Placements have no `status` column — visibility follows the parent event's status.
- Extraction is freeform, paste-first; the `Extractor` seam stays mockable so CI needs no API key (tests use `FakeExtractor`).
- Model id from `INGEST_MODEL`, default `claude-opus-4-8`. Do not hard-code elsewhere.
- Structured outputs via JSON schema (`z.toJSONSchema` + `output_config.format`), not tool-use.
- Commit counts = **newly-created** rows (merges and skipped duplicates excluded).
- TDD, one commit per task. Run `npm test`, `npx tsc --noEmit`, and `npm run build` clean before the final merge.

---

### Task 1: Placement in the extraction schema

**Files:**
- Modify: `src/lib/ingestion/schema.ts`
- Test: `src/lib/ingestion/schema.test.ts`
- Modify (fixtures, to keep the suite compiling): `src/lib/ingestion/extract.test.ts`, `src/lib/ingestion/resolve.test.ts`, `src/lib/ingestion/service.test.ts`

**Interfaces:**
- Produces:
  - `PlacementCandidateSchema` — Zod object `{ localRef: string, eventRef: string, athleteRef: string, division: string, place: number(int, positive) }`
  - `ExtractionSchema` gains a required `placements: PlacementCandidate[]` array (sibling of `athletes`/`promotions`/`events`/`matches`)
  - `type PlacementCandidate = z.infer<typeof PlacementCandidateSchema>`
  - `CandidateGraph` (= `z.infer<typeof ExtractionSchema>`) now requires a `placements` key.

- [ ] **Step 1: Write the failing test**

In `src/lib/ingestion/schema.test.ts`, add `placements` to the `sample` object and two assertions. Replace the `sample` const and add tests:

```ts
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
  placements: [
    { localRef: "pl1", eventRef: "e1", athleteRef: "a1", division: "Absolute", place: 1 },
  ],
};
```

Add these two tests inside the `describe("ExtractionSchema", ...)` block:

```ts
  it("parses placements referencing event and athlete", () => {
    const parsed = ExtractionSchema.parse(sample);
    expect(parsed.placements[0]?.athleteRef).toBe("a1");
    expect(parsed.placements[0]?.place).toBe(1);
  });

  it("rejects a placement with a non-positive place", () => {
    const bad = structuredClone(sample);
    bad.placements[0].place = 0;
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/schema.test.ts`
Expected: FAIL — the placement assertions fail because `ExtractionSchema` has no `placements` field (parsed value strips it / type error).

- [ ] **Step 3: Add the schema**

In `src/lib/ingestion/schema.ts`, add the placement schema before `ExtractionSchema`:

```ts
export const PlacementCandidateSchema = z.object({
  localRef: z.string().min(1),
  eventRef: z.string().min(1),
  athleteRef: z.string().min(1),
  division: z.string().min(1),
  place: z.number().int().positive(),
});
```

Add `placements` to `ExtractionSchema`:

```ts
export const ExtractionSchema = z.object({
  athletes: z.array(AthleteCandidateSchema),
  promotions: z.array(PromotionCandidateSchema),
  events: z.array(EventCandidateSchema),
  matches: z.array(MatchCandidateSchema),
  placements: z.array(PlacementCandidateSchema),
});
```

Add the exported type alongside the others:

```ts
export type PlacementCandidate = z.infer<typeof PlacementCandidateSchema>;
```

- [ ] **Step 4: Keep the other fixtures compiling**

`placements` is now a required key on `CandidateGraph`. Add `placements: []` to each existing `CandidateGraph` literal so the suite still compiles:

- `src/lib/ingestion/extract.test.ts` — in the `graph` const, after the `matches: [...]` line add: `  placements: [],`
- `src/lib/ingestion/resolve.test.ts` — in the `graph` const, after `matches: [],` add: `  placements: [],`
- `src/lib/ingestion/service.test.ts` — in the `graph` const, after the `matches: [...]` block add: `  placements: [],`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/ingestion/`
Expected: PASS (schema tests green; extract/resolve/service tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingestion/schema.ts src/lib/ingestion/schema.test.ts \
  src/lib/ingestion/extract.test.ts src/lib/ingestion/resolve.test.ts \
  src/lib/ingestion/service.test.ts
git commit -m "feat(ingest): add placement candidate to extraction schema"
```

---

### Task 2: Resolve emits placement candidates

**Files:**
- Modify: `src/lib/ingestion/resolve.ts`
- Test: `src/lib/ingestion/resolve.test.ts`

**Interfaces:**
- Consumes: `CandidateGraph.placements` (Task 1).
- Produces: `resolveCandidates` returns one `ResolvedCandidate` per placement with `entityType: "placement"`, `payload` = the placement candidate, and `resolvedEntityId/resolvedEntityType/matchScore` all `null`. `ResolvedCandidate.entityType` union gains `"placement"`.

- [ ] **Step 1: Write the failing test**

In `src/lib/ingestion/resolve.test.ts`, extend the `graph` fixture and add a test. Change `events: []` / `matches: []` / `placements: []` so there is an event + a placement to resolve:

```ts
const graph: CandidateGraph = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan" },
    { localRef: "a2", fullName: "Totally New Person" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC" }],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [],
  placements: [
    { localRef: "pl1", eventRef: "e1", athleteRef: "a1", division: "Absolute", place: 1 },
  ],
};
```

Add this test after the existing one:

```ts
  it("emits placement candidates with no resolution proposal", async () => {
    const resolved = await resolveCandidates(ctx.db, graph);
    const placement = resolved.find((r) => r.entityType === "placement");
    expect(placement).toBeDefined();
    expect(placement!.localRef).toBe("pl1");
    expect(placement!.resolvedEntityId).toBeNull();
    expect(placement!.matchScore).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/resolve.test.ts`
Expected: FAIL — `placement` is `undefined`; resolve never emits placement candidates.

- [ ] **Step 3: Implement**

In `src/lib/ingestion/resolve.ts`, widen the union in the `ResolvedCandidate` type:

```ts
export type ResolvedCandidate = {
  entityType: "athlete" | "promotion" | "event" | "match" | "placement";
  localRef: string;
  payload: unknown;
  resolvedEntityId: string | null;
  resolvedEntityType: string | null;
  matchScore: number | null;
};
```

Add a placement loop after the matches loop, before `return out;`:

```ts
  // Placements: edges like matches — no resolution proposal in v1.
  for (const pl of graph.placements) {
    out.push({
      entityType: "placement",
      localRef: pl.localRef,
      payload: pl,
      resolvedEntityId: null,
      resolvedEntityType: null,
      matchScore: null,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/resolve.ts src/lib/ingestion/resolve.test.ts
git commit -m "feat(ingest): resolve emits placement candidates"
```

---

### Task 3: Commit placements

**Files:**
- Modify: `src/lib/ingestion/service.ts`
- Test: `src/lib/ingestion/service.test.ts`

**Interfaces:**
- Consumes: `ResolvedCandidate` with `entityType: "placement"` (Task 2); `addPlacement` from `@/lib/placements/service` with input `{ eventId, athleteId, division, place, sourceUrl?, verifiedBy?, confidence? }`.
- Produces: `commitBatch` return type gains `placements: number`; the full type is `{ promotions: number; events: number; athletes: number; matches: number; placements: number }`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/ingestion/service.test.ts`:

Add imports near the top (after the existing `matches` import):

```ts
import { placements } from "@/db/schema/placement";
```

Extend the shared `graph` fixture: replace `placements: [],` with a real placement:

```ts
  placements: [
    { localRef: "pl1", eventRef: "e1", athleteRef: "a1", division: "Absolute", place: 1 },
  ],
```

Update the existing candidate-count assertion (the `runExtraction persists candidates` test) from `5` to `6`:

```ts
    expect(loaded.candidates).toHaveLength(6); // 2 athletes, 1 promo, 1 event, 1 match, 1 placement
```

Update the existing `commitBatch writes draft/NEEDS_REVIEW rows` counts assertion to include placements:

```ts
    expect(counts).toEqual({ promotions: 1, events: 1, athletes: 2, matches: 1, placements: 1 });
```

Add three new tests inside `describe("ingestion service", ...)`:

```ts
  it("commits placements linked to the resolved event and athlete", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);

    const placementRows = await ctx.db.select().from(placements);
    expect(placementRows).toHaveLength(1);
    expect(placementRows[0]!.division).toBe("Absolute");
    expect(placementRows[0]!.place).toBe(1);
    expect(placementRows[0]!.confidence).toBe("NEEDS_REVIEW");

    const athleteRows = await ctx.db.select().from(athletes);
    const gordon = athleteRows.find((a) => a.fullName === "Gordon Ryan")!;
    expect(placementRows[0]!.athleteId).toBe(gordon.id);
  });

  it("rejects the commit when a placement references a rejected event", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isEvent = c.entityType === "event";
      await setDecision(ctx.db, c.id, isEvent ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/uncommitted event ref/);
  });

  it("skips a duplicate placement instead of aborting the commit", async () => {
    // First batch commits the placement.
    const first = await extractAll();
    await acceptAll(first.id);
    await commitBatch(ctx.db, first.id);

    // A second batch with the same event+athlete+division must not throw and
    // must not create a second placement row.
    const second = await extractAll();
    await acceptAll(second.id);
    const counts = await commitBatch(ctx.db, second.id);
    expect(counts.placements).toBe(0);

    const placementRows = await ctx.db.select().from(placements);
    expect(placementRows).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ingestion/service.test.ts`
Expected: FAIL — `counts` has no `placements` key, no placement rows are written, and ref-validation for placements does not exist.

- [ ] **Step 3: Implement the commit changes**

In `src/lib/ingestion/service.ts`:

Add imports (with the other `create*`/schema imports at the top):

```ts
import { and } from "drizzle-orm";
import { placements } from "@/db/schema/placement";
import { addPlacement } from "@/lib/placements/service";
import type {
  AthleteCandidate, PromotionCandidate, EventCandidate, MatchCandidate, PlacementCandidate,
} from "@/lib/ingestion/schema";
```

(Merge `PlacementCandidate` into the existing multi-name schema import rather than duplicating it; `eq` is already imported — add `and` to that same `drizzle-orm` import line.)

Change the `commitBatch` return type:

```ts
): Promise<{ promotions: number; events: number; athletes: number; matches: number; placements: number }> {
```

Add `placements` to the `counts` initializer:

```ts
  const counts = { promotions: 0, events: 0, athletes: 0, matches: 0, placements: 0 };
```

Add placement ref pre-validation after the existing match pre-validation loop (the `for (const c of byType("match"))` block that checks `eventRefs`/`athleteRefs`):

```ts
  for (const c of byType("placement")) {
    const pl = c.payload as PlacementCandidate;
    if (!eventRefs.has(pl.eventRef)) {
      throw new Error(`commitBatch: placement ${pl.localRef} references uncommitted event ref ${pl.eventRef}`);
    }
    if (!athleteRefs.has(pl.athleteRef)) {
      throw new Error(`commitBatch: placement ${pl.localRef} references uncommitted athlete ref ${pl.athleteRef}`);
    }
  }
```

Inside the `db.transaction` callback, add a placement loop after the `for (const c of byType("match"))` block and before the final `tx.update(ingestionBatches).set({ status: "committed" })`:

```ts
    for (const c of byType("placement")) {
      const pl = c.payload as PlacementCandidate;
      const eventId = eventMap.get(pl.eventRef)!;
      const athleteId = athleteMap.get(pl.athleteRef)!;

      // Unique (event, athlete, division): skip an existing placement so a
      // re-ingest does not abort the whole transactional commit.
      const dup = await tx
        .select({ id: placements.id })
        .from(placements)
        .where(and(
          eq(placements.eventId, eventId),
          eq(placements.athleteId, athleteId),
          eq(placements.division, pl.division),
        ));
      const existingId = dup[0]?.id;

      const id = existingId ?? (await addPlacement(stx, {
        eventId,
        athleteId,
        division: pl.division,
        place: pl.place,
        confidence: provenance.confidence,
        verifiedBy: provenance.verifiedBy,
        sourceUrl: provenance.sourceUrl,
      })).id;

      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: id })
        .where(eq(ingestionCandidates.id, c.id));

      if (!existingId) counts.placements += 1;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ingestion/service.test.ts`
Expected: PASS (all service tests green, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/service.ts src/lib/ingestion/service.test.ts
git commit -m "feat(ingest): commit placements with ref validation and dedup"
```

---

### Task 4: Teach the extractor about placements

**Files:**
- Modify: `src/lib/ingestion/extract.ts`
- Test: `src/lib/ingestion/extract.test.ts`

**Interfaces:**
- Consumes: nothing new (`FakeExtractor` already returns whatever `CandidateGraph` it is given, so placements flow through automatically).
- Produces: `EXTRACTION_SYSTEM_PROMPT` instructs the model to emit placements. The `ClaudeExtractor` picks up the new schema automatically via `z.toJSONSchema(ExtractionSchema)`.

- [ ] **Step 1: Write the failing test**

In `src/lib/ingestion/extract.test.ts`, add the import and a guard test:

```ts
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/ingestion/extract";
```

(Add `EXTRACTION_SYSTEM_PROMPT` to the existing `@/lib/ingestion/extract` import rather than a second import line.)

```ts
describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("instructs the model to emit placements", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/placement/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/extract.test.ts`
Expected: FAIL — the prompt does not mention placements yet.

- [ ] **Step 3: Update the prompt**

In `src/lib/ingestion/extract.ts`, replace `EXTRACTION_SYSTEM_PROMPT` with:

```ts
export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured BJJ / no-gi grappling records from pasted text.",
  "Return athletes, promotions, events, matches, and placements you can find.",
  "Give every entity a short unique localRef (e.g. a1, p1, e1, m1, pl1).",
  "Matches reference their event via eventRef and each competitor via athleteRef;",
  "events reference their promotion via promotionRef; placements reference their",
  "event via eventRef and athlete via athleteRef — always use the localRefs of",
  "entities you also returned. A placement records that an athlete finished in a",
  "given division/weight class at a given place (1 = champion, 2 = runner-up,",
  "3 = third). Dates are YYYY-MM-DD. Only include facts present in the text; do",
  "not invent competitors, methods, placements, or dates.",
].join(" ");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/extract.ts src/lib/ingestion/extract.test.ts
git commit -m "feat(ingest): extractor prompt guidance for placements"
```

---

### Task 5: Show placements in the review commit summary

**Files:**
- Modify: `src/app/admin/ingest/[id]/review.tsx`

**Interfaces:**
- Consumes: the commit route returns `counts` (now including `placements`) directly — no route change needed (`src/app/api/admin/ingest/[id]/commit/route.ts` returns `NextResponse.json(counts)`).
- Produces: the commit-success message includes the placements count.

- [ ] **Step 1: Update the summary line**

In `src/app/admin/ingest/[id]/review.tsx`, change the success branch of `setMessage` inside `commit()`:

```tsx
    setMessage(res.ok
      ? `Committed: ${data.promotions} promotions, ${data.events} events, ${data.athletes} athletes, ${data.matches} matches, ${data.placements} placements (as drafts).`
      : `Commit failed: ${data.error}`);
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS — no type errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/ingest/[id]/review.tsx"
git commit -m "feat(ingest): show placements count in review commit summary"
```

---

### Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (existing count + the new schema/resolve/service/extract tests).

- [ ] **Step 2: Typecheck + production build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Merge to main (no push yet)**

Merge the feature branch to `main` with a `--no-ff` merge commit (mirrors prior phases). Then STOP and get explicit OK before `git push`.

---

## Self-Review

**Spec coverage:**
- Extraction schema (`PlacementCandidateSchema` + array + type) → Task 1. ✓
- Extractor prompt + `FakeExtractor` passthrough → Task 4 (FakeExtractor needs no change; verified it returns the given graph). ✓
- Resolve emits `"placement"` edges, no proposal → Task 2. ✓
- Commit loop after athletes, ref pre-validation, `{confidence, verifiedBy, sourceUrl}` provenance without `status`, counts.placements → Task 3. ✓
- Idempotency (unique event/athlete/division dedup skip) → Task 3, "skips a duplicate placement" test. ✓
- Route + UI summary → Task 5 (route returns `counts` directly, so only the UI string changes). ✓
- Testing list (schema parse, positive-int place, resolve no-proposal, commit happy path + ref validation + duplicate skip) → Tasks 1–3. ✓

**Placeholder scan:** No TODO/TBD/"handle edge cases" — every code step shows the actual code. ✓

**Type consistency:** `commitBatch` return type `{promotions, events, athletes, matches, placements}` is used identically in Task 3 (return type + counts init) and consumed by Task 5's summary. `addPlacement` input matches `src/lib/placements/service.ts` (`eventId, athleteId, division, place, sourceUrl?, verifiedBy?, confidence?` — no `status`). `PlacementCandidate` field names (`localRef, eventRef, athleteRef, division, place`) are consistent across schema, resolve, and commit. ✓
