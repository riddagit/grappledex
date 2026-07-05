# BJJ Heroes Roster/Stats Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill RollVault's database from ~1,500 BJJ Heroes fighter profiles — athletes, teams, competitions/events, and match records — via an offline, re-runnable CLI that auto-imports the clean majority as drafts and routes only conflicts to the existing admin review queue.

**Architecture:** A self-contained `src/lib/ingestion/bjjheroes/` module. Pure units (enumerate → parse → classify) turn public HTML into structured rows; a `load` unit resolves entities against the DB (reusing existing `create*` services + the fuzzy name matcher) and upserts idempotently, returning conflicts instead of guessing. A thin CLI (`backfill.ts`) orchestrates a rate-limited crawl and persists conflicts to `ingestion_candidates`. Deterministic parsing — **no LLM**.

**Tech Stack:** TypeScript (ESM), Next.js app repo, Drizzle ORM + Postgres (pglite in tests), `jsdom` (already a dep), `vitest`, `drizzle-kit` for migrations, `tsx` for the CLI.

## Global Constraints

- TypeScript strict mode with `noUncheckedIndexedAccess` — array/tuple access is `T | undefined`; guard every index. (This repo's tsc catches errors tests don't.)
- All imported rows are written `status = "draft"`, `confidence = "NEEDS_REVIEW"`, with `sourceUrl` provenance. Never publish.
- Reuse existing services (`createAthlete`, `createPromotion`, `createEvent`, `createMatch`, `createTeam`, `addMembership`) and the existing matcher (`findAthleteDuplicates`, `findDuplicateCandidates`, `slugify`, `normalizeName`). Do not reimplement resolution.
- Tests use in-process pglite via `createTestDb()` from `@/db/test-db`, which runs the real migrations in `./drizzle`. A schema change is only visible to tests after `npm run db:generate`.
- HTTP crawl is single-threaded, rate-limited (~1 req / 1.5 s), honest User-Agent `RollVaultIngestBot/1.0 (+https://rollvault.net)`, with retry/backoff. Respect robots.txt (only `/wp-admin/` disallowed).
- Path alias `@/` → `src/`. Vitest config already resolves it.
- Run the full suite with `npm test` (vitest run). Type-check with `npx tsc --noEmit`.

---

### Task 1: Add `format` and `source_ref` to matches

Adds the two columns the backfill needs: `format` (the no-gi filter tag) and `source_ref` (the unique cross-profile dedup key), and threads them through `createMatch`.

**Files:**
- Modify: `src/db/schema/match.ts`
- Modify: `src/lib/matches/service.ts`
- Generate: `drizzle/0014_*.sql` (via `npm run db:generate`)
- Test: `src/lib/matches/service.test.ts`

**Interfaces:**
- Produces: `matches.format: "nogi" | "gi" | "unknown"` (default `"unknown"`), `matches.sourceRef: string | null` (unique). `CreateMatchInput` gains optional `format?: "nogi" | "gi" | "unknown"` and `sourceRef?: string`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/matches/service.test.ts` (follow the existing setup in that file — `createTestDb`, seeded event/athletes). If a helper to create an event+athletes already exists in the file, reuse it; otherwise mirror the existing arrangement.

```ts
it("persists format and a unique source_ref", async () => {
  const { db } = ctx; // ctx from the file's beforeEach
  const { eventId, aId, bId } = await seedEventAndAthletes(db); // existing/mirrored helper

  const m = await createMatch(db, {
    eventId, matchType: "SUPERFIGHT", method: "SUBMISSION",
    format: "nogi", sourceRef: "bjjheroes:8858",
    competitors: [
      { athleteId: aId, outcome: "WON", slotOrder: 1 },
      { athleteId: bId, outcome: "LOST", slotOrder: 2 },
    ],
  });

  const row = (await db.select().from(matches).where(eq(matches.id, m.id)))[0];
  expect(row?.format).toBe("nogi");
  expect(row?.sourceRef).toBe("bjjheroes:8858");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/matches/service.test.ts -t "source_ref"`
Expected: FAIL — `format`/`sourceRef` not accepted by `CreateMatchInput` / column missing.

- [ ] **Step 3: Add the columns to the schema**

In `src/db/schema/match.ts`, inside the `matches` table definition, add after `methodDetail`:

```ts
    format: text("format", { enum: ["nogi", "gi", "unknown"] })
      .notNull()
      .default("unknown"),
    sourceRef: text("source_ref"),
```

And add a unique constraint in the table's second-arg array (alongside the existing `index(...)`):

```ts
  (t) => [
    index("matches_event_id_idx").on(t.eventId),
    unique("matches_source_ref_uq").on(t.sourceRef),
  ],
```

`unique` is already imported in this file.

- [ ] **Step 4: Thread the fields through the service**

In `src/lib/matches/service.ts`, add to `CreateMatchInput`:

```ts
  format?: "nogi" | "gi" | "unknown";
  sourceRef?: string;
```

And in the `.values({ ... })` object inside `createMatch`, add:

```ts
        format: input.format ?? "unknown",
        sourceRef: input.sourceRef ?? null,
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0014_*.sql` file is created containing `ALTER TABLE "matches" ADD COLUMN "format" ...`, `ADD COLUMN "source_ref" ...`, and the unique constraint. Open it and confirm it only touches `matches`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/matches/service.test.ts -t "source_ref"`
Expected: PASS (pglite applies the new migration via `createTestDb`).

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/db/schema/match.ts src/lib/matches/service.ts src/lib/matches/service.test.ts drizzle/
git commit -m "feat(match): add format tag and unique source_ref for backfill"
```

---

### Task 2: Classifiers (format, match type, method)

Pure functions that map BJJ Heroes' free-text columns onto RollVault's enums. Table-driven and honest — ambiguous inputs return `"unknown"` rather than guessing.

**Files:**
- Create: `src/lib/ingestion/bjjheroes/classify.ts`
- Test: `src/lib/ingestion/bjjheroes/classify.test.ts`

**Interfaces:**
- Produces:
  - `classifyFormat(competition: string): "nogi" | "gi" | "unknown"`
  - `classifyMatchType(stage: string | null): { matchType: "BRACKET" | "SUPERFIGHT"; round: string | null }`
  - `classifyMethod(raw: string): { method: "SUBMISSION" | "POINTS" | "DECISION" | "DQ" | "OVERTIME" | "FORFEIT" | "NC" | "DRAW"; methodDetail: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyFormat, classifyMatchType, classifyMethod } from "./classify";

describe("classifyFormat", () => {
  it("tags known no-gi promotions", () => {
    expect(classifyFormat("ADCC 2022 World Championship")).toBe("nogi");
    expect(classifyFormat("Who's Number One")).toBe("nogi");
    expect(classifyFormat("Polaris 21")).toBe("nogi");
  });
  it("tags known gi promotions", () => {
    expect(classifyFormat("IBJJF World Championship")).toBe("gi");
    expect(classifyFormat("IBJJF Pans")).toBe("gi");
  });
  it("returns unknown for unrecognised competitions", () => {
    expect(classifyFormat("Studio 540 SPF")).toBe("unknown");
  });
});

describe("classifyMatchType", () => {
  it("maps superfight stages", () => {
    expect(classifyMatchType("SPF")).toEqual({ matchType: "SUPERFIGHT", round: null });
  });
  it("maps bracket stages to a readable round", () => {
    expect(classifyMatchType("F")).toEqual({ matchType: "BRACKET", round: "Final" });
    expect(classifyMatchType("SF")).toEqual({ matchType: "BRACKET", round: "Semifinal" });
  });
  it("defaults to bracket with null round when unknown", () => {
    expect(classifyMatchType(null)).toEqual({ matchType: "BRACKET", round: null });
  });
});

describe("classifyMethod", () => {
  it("maps points and decisions", () => {
    expect(classifyMethod("Points")).toEqual({ method: "POINTS", methodDetail: null });
    expect(classifyMethod("Referee Decision")).toEqual({ method: "DECISION", methodDetail: null });
    expect(classifyMethod("Pts: 2x0")).toEqual({ method: "POINTS", methodDetail: "Pts: 2x0" });
  });
  it("treats named techniques as submissions with detail", () => {
    expect(classifyMethod("RNC")).toEqual({ method: "SUBMISSION", methodDetail: "RNC" });
    expect(classifyMethod("Armbar")).toEqual({ method: "SUBMISSION", methodDetail: "Armbar" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/bjjheroes/classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `classify.ts`**

```ts
// Deterministic mappers from BJJ Heroes' free-text columns to RollVault enums.
// Ambiguous inputs deliberately return "unknown"/null so the review queue (not a
// guess) resolves them.

const NOGI_KEYWORDS = [
  "adcc", "who's number one", "whos number one", "wno", "ebi",
  "eddie bravo invitational", "polaris", "submission underground", "sug",
  "no-gi", "nogi", "no gi", "quintet", "kinektic", "adww",
];
const GI_KEYWORDS = [
  "ibjjf", "jiu-jitsu world", "world jiu", "pans", "pan-american", "pan american",
  "european championship", "brazilian nationals", "gi ", " gi", "worlds gi",
];

export function classifyFormat(competition: string): "nogi" | "gi" | "unknown" {
  const c = competition.toLowerCase();
  if (NOGI_KEYWORDS.some((k) => c.includes(k))) return "nogi";
  if (GI_KEYWORDS.some((k) => c.includes(k))) return "gi";
  return "unknown";
}

const ROUND_LABELS: Record<string, string> = {
  f: "Final", sf: "Semifinal", qf: "Quarterfinal",
  "4f": "Quarterfinal", "8f": "Round of 16", "16f": "Round of 32",
  r1: "Round 1", r2: "Round 2",
};

export function classifyMatchType(
  stage: string | null,
): { matchType: "BRACKET" | "SUPERFIGHT"; round: string | null } {
  if (!stage) return { matchType: "BRACKET", round: null };
  const s = stage.trim().toLowerCase();
  if (s === "spf" || s.includes("superfight")) {
    return { matchType: "SUPERFIGHT", round: null };
  }
  return { matchType: "BRACKET", round: ROUND_LABELS[s] ?? null };
}

// Non-submission method keywords. Anything else that names a technique is a submission.
const NON_SUBMISSION: Array<{
  test: RegExp;
  method: "POINTS" | "DECISION" | "DQ" | "OVERTIME" | "FORFEIT" | "NC" | "DRAW";
}> = [
  { test: /^pts|points/i, method: "POINTS" },
  { test: /^adv|advantage/i, method: "POINTS" },
  { test: /decision|ref\.?\s*decision/i, method: "DECISION" },
  { test: /^dq|disqualif/i, method: "DQ" },
  { test: /overtime|^ot\b|ebi ot/i, method: "OVERTIME" },
  { test: /forfeit|w\.?o\.?|walkover/i, method: "FORFEIT" },
  { test: /^n\/?a|no contest|^nc\b/i, method: "NC" },
  { test: /draw/i, method: "DRAW" },
];

export function classifyMethod(raw: string): {
  method: "SUBMISSION" | "POINTS" | "DECISION" | "DQ" | "OVERTIME" | "FORFEIT" | "NC" | "DRAW";
  methodDetail: string | null;
} {
  const trimmed = raw.trim();
  for (const rule of NON_SUBMISSION) {
    if (rule.test.test(trimmed)) {
      // Keep detail only when it carries more than the bare category word.
      const bare = /^(pts|points|decision|dq|ot|overtime|n\/?a|nc|draw|adv|advantages?)$/i;
      return { method: rule.method, methodDetail: bare.test(trimmed) ? null : trimmed };
    }
  }
  return { method: "SUBMISSION", methodDetail: trimmed || null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/bjjheroes/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/bjjheroes/classify.ts src/lib/ingestion/bjjheroes/classify.test.ts
git commit -m "feat(bjjheroes): add format/matchType/method classifiers"
```

---

### Task 3: Profile parser

Turns a fighter profile's HTML into a structured `BjjHeroesProfile`. Pure, tested against a committed real fixture.

**Files:**
- Create: `src/lib/ingestion/bjjheroes/parse.ts`
- Create: `src/lib/ingestion/bjjheroes/__fixtures__/gordon-ryan.html`
- Test: `src/lib/ingestion/bjjheroes/parse.test.ts`

**Interfaces:**
- Produces:
```ts
export type BjjHeroesRecord = {
  bjjHeroesId: string;      // "8858" — the record-table ID column (dedup key)
  opponentName: string;     // "Felipe Pena"
  outcome: "WON" | "LOST" | "DRAW";
  methodRaw: string;        // "RNC", "Points", "Referee Decision"
  competition: string;      // "Studio 540 SPF"
  weightLabel: string | null; // "ABS"
  stage: string | null;     // "SPF", "F"
  year: number;             // 2016
};
export type BjjHeroesProfile = {
  slug: string;             // "gordon-ryan" (from the URL)
  fullName: string;         // <h1 itemprop="name">
  formalName: string | null;// "Full Name:" bio value
  nickname: string | null;
  teamName: string | null;  // "Team/Association:" bio value
  weightLabel: string | null; // "Weight Division:" bio value
  records: BjjHeroesRecord[];
};
export function parseProfile(html: string, url: string): BjjHeroesProfile;
```

- [ ] **Step 1: Save the fixture**

Fetch one real profile and commit it so the test is deterministic and offline:

```bash
mkdir -p src/lib/ingestion/bjjheroes/__fixtures__
curl -s -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36" \
  "https://www.bjjheroes.com/bjj-fighters/gordon-ryan" \
  -o src/lib/ingestion/bjjheroes/__fixtures__/gordon-ryan.html
```

Confirm it contains the record table: `grep -c "itemprop=\"name\"" src/lib/ingestion/bjjheroes/__fixtures__/gordon-ryan.html` should print `1`, and `grep -o "Full Name:" ...` should match. (Observed structure, for reference: name in `<h1 itemprop="name">Gordon Ryan</h1>`; bio lines as `<p><strong>Full Name:</strong> Gordon F. Ryan III</p>`; record rows as `<tr><td>8858</td><td class='sort'><span>Tex Johnson</span><a href='/?p=9246'>Tex Johnson</a></td><td style='color:#d91300;'>L</td><td>Points</td><td>Grappling Ind.</td><td>ABS</td><td>F</td><td>2016</td></tr>`.)

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseProfile, type BjjHeroesProfile } from "./parse";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "__fixtures__/gordon-ryan.html"), "utf8");

let profile: BjjHeroesProfile;
beforeAll(() => {
  profile = parseProfile(html, "https://www.bjjheroes.com/bjj-fighters/gordon-ryan");
});

it("extracts identity from the profile", () => {
  expect(profile.slug).toBe("gordon-ryan");
  expect(profile.fullName).toBe("Gordon Ryan");
  expect(profile.formalName).toContain("Gordon");
});

it("extracts a non-empty record with well-formed rows", () => {
  expect(profile.records.length).toBeGreaterThan(10);
  const r = profile.records[0]!;
  expect(r.bjjHeroesId).toMatch(/^\d+$/);
  expect(r.opponentName.length).toBeGreaterThan(0);
  expect(["WON", "LOST", "DRAW"]).toContain(r.outcome);
  expect(r.year).toBeGreaterThan(1990);
  expect(r.year).toBeLessThan(2100);
});

it("dedups nothing itself but yields unique record IDs", () => {
  const ids = profile.records.map((r) => r.bjjHeroesId);
  expect(new Set(ids).size).toBe(ids.length);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/bjjheroes/parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `parse.ts`**

```ts
import { JSDOM } from "jsdom";

export type BjjHeroesRecord = {
  bjjHeroesId: string;
  opponentName: string;
  outcome: "WON" | "LOST" | "DRAW";
  methodRaw: string;
  competition: string;
  weightLabel: string | null;
  stage: string | null;
  year: number;
};
export type BjjHeroesProfile = {
  slug: string;
  fullName: string;
  formalName: string | null;
  nickname: string | null;
  teamName: string | null;
  weightLabel: string | null;
  records: BjjHeroesRecord[];
};

function slugFromUrl(url: string): string {
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Bio lines are `<p><strong>Label:</strong> value</p>`. Find the <strong> whose
// text starts with the label and return the trailing text of its parent <p>.
function bioValue(doc: Document, label: string): string | null {
  const strongs = Array.from(doc.querySelectorAll("p strong"));
  for (const s of strongs) {
    if ((s.textContent ?? "").trim().toLowerCase().startsWith(label.toLowerCase())) {
      const parentText = (s.parentElement?.textContent ?? "").trim();
      const value = parentText.slice((s.textContent ?? "").length).trim();
      return value.length ? value : null;
    }
  }
  return null;
}

function outcomeFrom(cell: string): "WON" | "LOST" | "DRAW" {
  const v = cell.trim().toUpperCase();
  if (v.startsWith("W")) return "WON";
  if (v.startsWith("D")) return "DRAW";
  return "LOST";
}

export function parseProfile(html: string, url: string): BjjHeroesProfile {
  const doc = new JSDOM(html).window.document;

  const fullName = (doc.querySelector('h1[itemprop="name"]')?.textContent ?? "").trim();

  const records: BjjHeroesRecord[] = [];
  for (const tr of Array.from(doc.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll("td"));
    if (cells.length !== 8) continue;
    const id = (cells[0]?.textContent ?? "").trim();
    if (!/^\d+$/.test(id)) continue; // skip header / non-record rows
    const yearNum = Number((cells[7]?.textContent ?? "").trim());
    if (!Number.isFinite(yearNum)) continue;
    records.push({
      bjjHeroesId: id,
      opponentName: (cells[1]?.textContent ?? "").trim(),
      outcome: outcomeFrom(cells[2]?.textContent ?? ""),
      methodRaw: (cells[3]?.textContent ?? "").trim(),
      competition: (cells[4]?.textContent ?? "").trim(),
      weightLabel: ((cells[5]?.textContent ?? "").trim()) || null,
      stage: ((cells[6]?.textContent ?? "").trim()) || null,
      year: yearNum,
    });
  }

  return {
    slug: slugFromUrl(url),
    fullName,
    formalName: bioValue(doc, "Full Name:"),
    nickname: bioValue(doc, "Nickname:"),
    teamName: bioValue(doc, "Team/Association:"),
    weightLabel: bioValue(doc, "Weight Division:"),
    records,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/bjjheroes/parse.test.ts`
Expected: PASS. If a record assertion fails, inspect the fixture's actual first-row cells and adjust cell indices — do not weaken the assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingestion/bjjheroes/parse.ts src/lib/ingestion/bjjheroes/parse.test.ts src/lib/ingestion/bjjheroes/__fixtures__/gordon-ryan.html
git commit -m "feat(bjjheroes): parse fighter profile HTML into structured records"
```

---

### Task 4: Sitemap enumerator

Lists all fighter profile URLs from the post-sitemaps.

**Files:**
- Create: `src/lib/ingestion/bjjheroes/enumerate.ts`
- Create: `src/lib/ingestion/bjjheroes/__fixtures__/post-sitemap.xml`
- Test: `src/lib/ingestion/bjjheroes/enumerate.test.ts`

**Interfaces:**
- Consumes: a `fetchText(url: string) => Promise<string>` function (injected, so tests need no network).
- Produces: `fighterProfileUrls(fetchText: FetchText): Promise<string[]>` and `const SITEMAP_URLS: string[]`. `type FetchText = (url: string) => Promise<string>`.

- [ ] **Step 1: Create the fixture**

Write `src/lib/ingestion/bjjheroes/__fixtures__/post-sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.bjjheroes.com/bjj-fighters/gordon-ryan</loc></url>
  <url><loc>https://www.bjjheroes.com/bjj-fighters/felipe-pena</loc></url>
  <url><loc>https://www.bjjheroes.com/bjj-news/some-article</loc></url>
  <url><loc>https://www.bjjheroes.com/bjj-fighters/gordon-ryan</loc></url>
</urlset>
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fighterProfileUrls } from "./enumerate";

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, "__fixtures__/post-sitemap.xml"), "utf8");

it("returns unique fighter profile URLs and drops non-fighter URLs", async () => {
  const fetchText = async () => xml; // every sitemap returns the same fixture
  const urls = await fighterProfileUrls(fetchText);
  expect(urls).toContain("https://www.bjjheroes.com/bjj-fighters/gordon-ryan");
  expect(urls).toContain("https://www.bjjheroes.com/bjj-fighters/felipe-pena");
  expect(urls.some((u) => u.includes("/bjj-news/"))).toBe(false);
  expect(new Set(urls).size).toBe(urls.length); // deduped across sitemaps
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/bjjheroes/enumerate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `enumerate.ts`**

```ts
export type FetchText = (url: string) => Promise<string>;

export const SITEMAP_URLS = [
  "https://www.bjjheroes.com/post-sitemap.xml",
  "https://www.bjjheroes.com/post-sitemap2.xml",
  "https://www.bjjheroes.com/post-sitemap3.xml",
];

const FIGHTER_PATH = "/bjj-fighters/";

export async function fighterProfileUrls(fetchText: FetchText): Promise<string[]> {
  const seen = new Set<string>();
  for (const sitemap of SITEMAP_URLS) {
    const xml = await fetchText(sitemap);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const url = m[1];
      if (url && url.includes(FIGHTER_PATH)) seen.add(url);
    }
  }
  return [...seen];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/bjjheroes/enumerate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingestion/bjjheroes/enumerate.ts src/lib/ingestion/bjjheroes/enumerate.test.ts src/lib/ingestion/bjjheroes/__fixtures__/post-sitemap.xml
git commit -m "feat(bjjheroes): enumerate fighter profile URLs from sitemaps"
```

---

### Task 5: Polite fetcher

A rate-limited, retrying HTTP text fetcher with an honest UA. Time and `fetch` are injected so tests are fast and deterministic.

**Files:**
- Create: `src/lib/ingestion/bjjheroes/fetcher.ts`
- Test: `src/lib/ingestion/bjjheroes/fetcher.test.ts`

**Interfaces:**
- Produces: `createFetcher(opts?: FetcherOptions): FetchText` where
```ts
type FetcherOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number; // default 1500
  maxRetries?: number;    // default 3
  userAgent?: string;     // default the RollVault bot UA
};
```
`FetchText` is the same `(url: string) => Promise<string>` type from Task 4 (import it from `./enumerate`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createFetcher } from "./fetcher";

function res(body: string, status = 200): Response {
  return new Response(body, { status });
}

it("returns body text and sends the honest UA", async () => {
  const fetchImpl = vi.fn(async () => res("<html>ok</html>"));
  const fetchText = createFetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
  const body = await fetchText("https://www.bjjheroes.com/x");
  expect(body).toContain("ok");
  const init = fetchImpl.mock.calls[0]![1] as RequestInit;
  expect((init.headers as Record<string, string>)["User-Agent"]).toContain("RollVaultIngestBot");
});

it("retries on 5xx then succeeds", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(res("busy", 503))
    .mockResolvedValueOnce(res("<html>ok</html>", 200));
  const fetchText = createFetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, maxRetries: 3 });
  const body = await fetchText("https://www.bjjheroes.com/x");
  expect(body).toContain("ok");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("throws after exhausting retries", async () => {
  const fetchImpl = vi.fn(async () => res("nope", 500));
  const fetchText = createFetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, maxRetries: 2 });
  await expect(fetchText("https://www.bjjheroes.com/x")).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/bjjheroes/fetcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fetcher.ts`**

```ts
import type { FetchText } from "./enumerate";

const DEFAULT_UA = "RollVaultIngestBot/1.0 (+https://rollvault.net)";

export type FetcherOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRetries?: number;
  userAgent?: string;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createFetcher(opts: FetcherOptions = {}): FetchText {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? wait;
  const minIntervalMs = opts.minIntervalMs ?? 1500;
  const maxRetries = opts.maxRetries ?? 3;
  const userAgent = opts.userAgent ?? DEFAULT_UA;

  let lastAt = 0;

  return async function fetchText(url: string): Promise<string> {
    let attempt = 0;
    // Single-threaded pacing: keep at least minIntervalMs between requests.
    const since = Date.now() - lastAt;
    if (since < minIntervalMs) await sleep(minIntervalMs - since);

    while (true) {
      attempt += 1;
      lastAt = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { "User-Agent": userAgent } });
      } catch (err) {
        if (attempt > maxRetries) throw err;
        await sleep(minIntervalMs * attempt);
        continue;
      }
      if (response.ok) return response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt > maxRetries) {
        throw new Error(`fetch ${url} failed: HTTP ${response.status}`);
      }
      await sleep(minIntervalMs * attempt); // linear backoff
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/bjjheroes/fetcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/bjjheroes/fetcher.ts src/lib/ingestion/bjjheroes/fetcher.test.ts
git commit -m "feat(bjjheroes): add rate-limited retrying fetcher"
```

---

### Task 6: Load a parsed profile into the DB

The core. Resolves entities idempotently, upserts the clean majority as drafts, and returns conflicts instead of guessing. Reuses existing services and the fuzzy matcher.

**Files:**
- Create: `src/lib/ingestion/bjjheroes/load.ts`
- Test: `src/lib/ingestion/bjjheroes/load.test.ts`

**Interfaces:**
- Consumes: `BjjHeroesProfile`/`BjjHeroesRecord` (Task 3); `classifyFormat`, `classifyMatchType`, `classifyMethod` (Task 2); `createAthlete`, `createPromotion`, `createEvent`, `createMatch` services; `findAthleteDuplicates`, `slugify`.
- Produces:
```ts
export type Conflict = {
  kind: "ambiguous-athlete" | "unknown-format";
  detail: string;
  recordId: string | null;
};
export type LoadResult = {
  subjectAthleteId: string;
  created: { athletes: number; promotions: number; events: number; matches: number };
  matchedAthletes: number;
  skippedMatches: number;
  conflicts: Conflict[];
};
export async function loadProfile(db: Db, profile: BjjHeroesProfile, sourceUrl: string): Promise<LoadResult>;
```

**Resolution rules (deterministic):**
- Athlete: `findAthleteDuplicates(db, name)` returns candidates scored ≥0.82, sorted desc (1.0 = exact normalized name). If exactly one candidate scores `=== 1` → reuse it (`matchedAthletes++`). If none scores ≥0.82 → create new athlete. Otherwise (near matches in [0.82, 1) or >1 exact) → **conflict** `ambiguous-athlete`; skip the record's match.
- Promotion: look up by `slug === slugify(competition)`; reuse or create. Event: name `"<competition> <year>"`, look up by `slug === slugify(name)`; reuse or create with `startDate = "<year>-01-01"`. (Coarse promotion taxonomy is expected and curated later in review.)
- Match: skip if a row with `sourceRef = "bjjheroes:<id>"` already exists (`skippedMatches++`); else create. This makes re-runs and the "same match on both profiles" case no-ops.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { loadProfile } from "./load";
import type { BjjHeroesProfile } from "./parse";
import { athletes } from "@/db/schema/athlete";
import { matches } from "@/db/schema/match";
import { createAthlete } from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const profile: BjjHeroesProfile = {
  slug: "gordon-ryan", fullName: "Gordon Ryan",
  formalName: "Gordon F. Ryan", nickname: null,
  teamName: "New Wave Jiu-Jitsu", weightLabel: "Over 100 kg",
  records: [
    { bjjHeroesId: "8858", opponentName: "Felipe Pena", outcome: "WON",
      methodRaw: "Points", competition: "ADCC 2022", weightLabel: "ABS",
      stage: "F", year: 2022 },
  ],
};

it("creates athletes, event, and a match tagged with format + source_ref", async () => {
  const { db } = ctx;
  const result = await loadProfile(db, profile, "https://www.bjjheroes.com/bjj-fighters/gordon-ryan");
  expect(result.created.matches).toBe(1);
  const allAthletes = await db.select().from(athletes);
  expect(allAthletes.map((a) => a.fullName).sort()).toEqual(["Felipe Pena", "Gordon Ryan"]);
  const m = (await db.select().from(matches).where(eq(matches.sourceRef, "bjjheroes:8858")))[0];
  expect(m?.format).toBe("nogi");
  expect(m?.status).toBe("draft");
});

it("is idempotent — re-loading the same profile creates no duplicate match", async () => {
  const { db } = ctx;
  await loadProfile(db, profile, "https://x");
  const second = await loadProfile(db, profile, "https://x");
  expect(second.created.matches).toBe(0);
  expect(second.skippedMatches).toBe(1);
  expect((await db.select().from(matches)).length).toBe(1);
});

it("routes an ambiguous opponent to conflicts instead of guessing", async () => {
  const { db } = ctx;
  // Two existing near-name athletes make 'Felype Pena' ambiguous (near, not exact).
  await createAthlete(db, { fullName: "Felipe Pena" });
  await createAthlete(db, { fullName: "Felipe Penna" });
  const p = { ...profile, records: [{ ...profile.records[0]!, opponentName: "Felype Pena" }] };
  const result = await loadProfile(db, p, "https://x");
  expect(result.conflicts.some((c) => c.kind === "ambiguous-athlete")).toBe(true);
  expect(result.created.matches).toBe(0); // match skipped, not mis-attributed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/bjjheroes/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `load.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { athletes } from "@/db/schema/athlete";
import { promotions } from "@/db/schema/promotion";
import { events } from "@/db/schema/event";
import { matches } from "@/db/schema/match";
import { slugify } from "@/lib/identity/normalize";
import { findAthleteDuplicates, createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { classifyFormat, classifyMatchType, classifyMethod } from "./classify";
import type { BjjHeroesProfile } from "./parse";

export type Conflict = {
  kind: "ambiguous-athlete" | "unknown-format";
  detail: string;
  recordId: string | null;
};
export type LoadResult = {
  subjectAthleteId: string;
  created: { athletes: number; promotions: number; events: number; matches: number };
  matchedAthletes: number;
  skippedMatches: number;
  conflicts: Conflict[];
};

type Counters = { created: LoadResult["created"]; matchedAthletes: number };

// Reuse-or-create an athlete by name. Returns null when ambiguous (caller conflicts).
async function resolveAthlete(
  db: Db, name: string, counters: Counters,
  opts: { sourceUrl?: string } = {},
): Promise<string | null> {
  const candidates = await findAthleteDuplicates(db, name); // scored >=0.82, desc
  const exact = candidates.filter((c) => c.score === 1);
  if (exact.length === 1) { counters.matchedAthletes += 1; return exact[0]!.id; }
  if (exact.length > 1) return null;            // genuinely ambiguous
  if (candidates.length > 0) return null;       // near but not exact — don't guess
  const created = await createAthlete(db, { fullName: name, sourceUrl: opts.sourceUrl });
  counters.created.athletes += 1;
  return created.id;
}

async function resolvePromotion(db: Db, name: string, counters: Counters): Promise<string> {
  const slug = slugify(name) || "promotion";
  const existing = await db.select({ id: promotions.id }).from(promotions).where(eq(promotions.slug, slug));
  if (existing[0]) return existing[0].id;
  const created = await createPromotion(db, { name });
  counters.created.promotions += 1;
  return created.id;
}

async function resolveEvent(
  db: Db, promotionId: string, name: string, year: number, counters: Counters,
): Promise<string> {
  const slug = slugify(name) || "event";
  const existing = await db.select({ id: events.id }).from(events).where(eq(events.slug, slug));
  if (existing[0]) return existing[0].id;
  const created = await createEvent(db, {
    promotionId, name, startDate: `${year}-01-01`,
  });
  counters.created.events += 1;
  return created.id;
}

async function matchExists(db: Db, sourceRef: string): Promise<boolean> {
  const rows = await db.select({ id: matches.id }).from(matches).where(eq(matches.sourceRef, sourceRef));
  return rows.length > 0;
}

const invert = (o: "WON" | "LOST" | "DRAW"): "WON" | "LOST" | "DRAW" =>
  o === "WON" ? "LOST" : o === "LOST" ? "WON" : "DRAW";

export async function loadProfile(
  db: Db, profile: BjjHeroesProfile, sourceUrl: string,
): Promise<LoadResult> {
  const counters: Counters = {
    created: { athletes: 0, promotions: 0, events: 0, matches: 0 },
    matchedAthletes: 0,
  };
  const conflicts: Conflict[] = [];
  let skippedMatches = 0;

  const subjectId = await resolveAthlete(db, profile.fullName, counters, { sourceUrl });
  if (!subjectId) {
    // The profile's own name is ambiguous — nothing anchors the records.
    return {
      subjectAthleteId: "",
      created: counters.created, matchedAthletes: counters.matchedAthletes,
      skippedMatches, conflicts: [{ kind: "ambiguous-athlete", detail: profile.fullName, recordId: null }],
    };
  }

  for (const rec of profile.records) {
    const sourceRef = `bjjheroes:${rec.bjjHeroesId}`;
    if (await matchExists(db, sourceRef)) { skippedMatches += 1; continue; }

    const opponentId = await resolveAthlete(db, rec.opponentName, counters);
    if (!opponentId) {
      conflicts.push({ kind: "ambiguous-athlete", detail: rec.opponentName, recordId: rec.bjjHeroesId });
      continue; // don't mis-attribute the match
    }

    const format = classifyFormat(rec.competition);
    if (format === "unknown") {
      conflicts.push({ kind: "unknown-format", detail: rec.competition, recordId: rec.bjjHeroesId });
    }
    const { matchType, round } = classifyMatchType(rec.stage);
    const { method, methodDetail } = classifyMethod(rec.methodRaw);

    const promotionId = await resolvePromotion(db, rec.competition, counters);
    const eventId = await resolveEvent(db, promotionId, `${rec.competition} ${rec.year}`, rec.year, counters);

    await createMatch(db, {
      eventId, matchType, round: round ?? undefined,
      weightClass: rec.weightLabel ?? undefined,
      method, methodDetail: methodDetail ?? undefined,
      format, sourceRef, sourceUrl,
      competitors: [
        { athleteId: subjectId, outcome: rec.outcome, slotOrder: 1 },
        { athleteId: opponentId, outcome: invert(rec.outcome), slotOrder: 2 },
      ],
    });
    counters.created.matches += 1;
  }

  return {
    subjectAthleteId: subjectId,
    created: counters.created,
    matchedAthletes: counters.matchedAthletes,
    skippedMatches, conflicts,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/bjjheroes/load.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/ingestion/bjjheroes/load.ts src/lib/ingestion/bjjheroes/load.test.ts
git commit -m "feat(bjjheroes): idempotent load of a parsed profile with conflict routing"
```

---

### Task 7: Backfill CLI + conflict persistence

Ties the units together into a runnable, resumable crawl, persists conflicts to a review batch, and prints a run report. Adds the npm script.

**Files:**
- Create: `src/lib/ingestion/bjjheroes/backfill.ts`
- Create: `src/lib/ingestion/bjjheroes/conflicts.ts`
- Test: `src/lib/ingestion/bjjheroes/conflicts.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: everything above; `createBatch` from `@/lib/ingestion/service`; `ingestionCandidates` schema.
- Produces: `recordConflicts(db, batchId, conflicts): Promise<void>` in `conflicts.ts`; a `main()` in `backfill.ts` run via tsx.

- [ ] **Step 1: Write the failing test for conflict persistence**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { createBatch } from "@/lib/ingestion/service";
import { recordConflicts } from "./conflicts";
import { ingestionCandidates } from "@/db/schema/ingestion";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

it("writes conflicts as ingestion candidates on the batch", async () => {
  const { db } = ctx;
  const batch = await createBatch(db, { sourceText: "BJJ Heroes backfill", sourceNote: "backfill" });
  await recordConflicts(db, batch.id, [
    { kind: "ambiguous-athlete", detail: "Felype Pena", recordId: "8858" },
    { kind: "unknown-format", detail: "Studio 540 SPF", recordId: "9000" },
  ]);
  const rows = await db.select().from(ingestionCandidates).where(eq(ingestionCandidates.batchId, batch.id));
  expect(rows.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/bjjheroes/conflicts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `conflicts.ts`**

Check `src/db/schema/ingestion.ts` for the exact `ingestionCandidates` columns before writing. It has at least `batchId`, `entityType`, `payload` (jsonb), `localRef`, `matchScore`. Map each conflict to a row; use `entityType: "athlete"` for ambiguous-athlete and the review-relevant type otherwise, and stash the human detail in `payload`.

```ts
import type { Db } from "@/db/client";
import { ingestionCandidates } from "@/db/schema/ingestion";
import type { Conflict } from "./load";

export async function recordConflicts(
  db: Db, batchId: string, conflicts: Conflict[],
): Promise<void> {
  if (!conflicts.length) return;
  await db.insert(ingestionCandidates).values(
    conflicts.map((c) => ({
      batchId,
      entityType: c.kind === "ambiguous-athlete" ? ("athlete" as const) : ("match" as const),
      payload: { reason: c.kind, detail: c.detail, bjjHeroesId: c.recordId },
      localRef: c.recordId ?? null,
    })),
  );
}
```

If `ingestionCandidates` requires columns not set here (e.g. a non-null field), add them with sensible values — inspect the schema; do not invent enum values outside its defined set.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/bjjheroes/conflicts.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the CLI `backfill.ts`** (no unit test; exercised by the gated smoke in Step 7)

```ts
// Offline, re-runnable BJJ Heroes backfill.
//   npm run ingest:bjjheroes -- --limit 5 --dry-run
import { db } from "@/db/client";
import { createBatch } from "@/lib/ingestion/service";
import { fighterProfileUrls } from "./enumerate";
import { createFetcher } from "./fetcher";
import { parseProfile } from "./parse";
import { loadProfile, type Conflict } from "./load";
import { recordConflicts } from "./conflicts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "true") : undefined;
}

async function main() {
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const dryRun = process.argv.includes("--dry-run");

  const fetchText = createFetcher();
  const allUrls = await fighterProfileUrls(fetchText);
  const urls = allUrls.slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`Found ${allUrls.length} profiles; processing ${urls.length}${dryRun ? " (dry run)" : ""}.`);

  const batch = dryRun ? null : await createBatch(db, {
    sourceText: `BJJ Heroes backfill ${new Date().toISOString()}`,
    sourceNote: "bjjheroes-backfill",
  });

  const totals = { athletes: 0, promotions: 0, events: 0, matches: 0, matched: 0, skipped: 0, errors: 0 };
  const allConflicts: Conflict[] = [];

  for (const [i, url] of urls.entries()) {
    try {
      const html = await fetchText(url);
      const profile = parseProfile(html, url);
      if (dryRun) {
        console.log(`[${i + 1}/${urls.length}] ${profile.fullName}: ${profile.records.length} records (dry run)`);
        continue;
      }
      const r = await loadProfile(db, profile, url);
      totals.athletes += r.created.athletes;
      totals.promotions += r.created.promotions;
      totals.events += r.created.events;
      totals.matches += r.created.matches;
      totals.matched += r.matchedAthletes;
      totals.skipped += r.skippedMatches;
      allConflicts.push(...r.conflicts);
      console.log(`[${i + 1}/${urls.length}] ${profile.fullName}: +${r.created.matches} matches, ${r.conflicts.length} conflicts`);
    } catch (err) {
      totals.errors += 1;
      console.error(`[${i + 1}/${urls.length}] ${url} FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (batch && allConflicts.length) await recordConflicts(db, batch.id, allConflicts);

  console.log("\nRun report:", JSON.stringify({ ...totals, conflicts: allConflicts.length }, null, 2));
  if (batch) console.log(`Conflicts queued on batch ${batch.id} — review at /admin/ingest/${batch.id}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Add the npm script**

In `package.json` `scripts`, add:

```json
    "ingest:bjjheroes": "tsx --env-file-if-exists=.env.local src/lib/ingestion/bjjheroes/backfill.ts",
```

- [ ] **Step 7: Gated live smoke (manual, not CI)**

With `.env.local` pointing at the docker DB (`docker compose up -d` first), run a tiny dry run to prove enumerate → fetch → parse end-to-end against the live site:

Run: `npm run ingest:bjjheroes -- --limit 3 --dry-run`
Expected: prints "Found ~1500 profiles; processing 3 (dry run)" and three lines each showing a fighter name and a record count > 0. Then a real tiny run: `npm run ingest:bjjheroes -- --limit 3` and confirm the run report shows created matches and a batch id.

- [ ] **Step 8: Full suite, type-check, commit**

Run: `npm test` (all pass) and `npx tsc --noEmit` (clean), then:

```bash
git add src/lib/ingestion/bjjheroes/backfill.ts src/lib/ingestion/bjjheroes/conflicts.ts src/lib/ingestion/bjjheroes/conflicts.test.ts package.json
git commit -m "feat(bjjheroes): backfill CLI with conflict queue and run report"
```

---

### Task 8: Source attribution in the public UI

Good-citizen requirement: a visible "data sourced from BJJ Heroes" credit.

**Files:**
- Modify: `src/app/(public)/layout.tsx` (or the shared footer/header component it renders)
- Test: none (static copy); verified visually.

- [ ] **Step 1: Add the attribution**

Add a small footer line in the public layout (match the existing markup/classes in that file — inspect it first):

```tsx
<footer className="site-footer">
  <p>Athlete records include data sourced from <a href="https://www.bjjheroes.com" rel="nofollow noopener" target="_blank">BJJ Heroes</a>.</p>
</footer>
```

Add minimal styling in `src/app/globals.css` consistent with the existing design tokens (`--muted`, `--faint`) if the footer needs it.

- [ ] **Step 2: Verify visually**

Run: `docker compose up -d && npm run dev`, open `http://localhost:3000`, confirm the attribution shows on public pages.

- [ ] **Step 3: Commit**

```bash
git add src/app/ 
git commit -m "chore(public): attribute BJJ Heroes as a data source"
```

---

## Self-Review

**Spec coverage:**
- Enumerate ~1,500 profiles via sitemaps → Task 4. ✅
- Deterministic parse of inline record tables → Task 3. ✅
- No LLM → whole plan is deterministic. ✅
- Format tag (nogi/gi/unknown) → Task 1 (column) + Task 2 (classifier) + Task 6 (applied). ✅
- `source_ref` cross-profile dedup + idempotent re-runs → Task 1 (unique column) + Task 6 (skip logic + test). ✅
- Auto-import drafts, conflicts to review queue only → Task 6 (returns conflicts, not guesses) + Task 7 (`recordConflicts` → `ingestion_candidates`). ✅
- Resolution chain competition→promotion→event→match→competitors → Task 6. ✅
- Opponents become athletes; stubs enriched later (order-independent via reuse-by-exact-name) → Task 6 `resolveAthlete`. ✅
- Year-only event dates set to `YYYY-01-01`, NEEDS_REVIEW → Task 6 `resolveEvent` (createEvent defaults confidence NEEDS_REVIEW). ✅
- Good citizen: rate-limit + honest UA + provenance + attribution → Task 5 (fetcher) + Task 6 (`sourceUrl`) + Task 8 (attribution). ✅
- Testing against saved fixtures + gated live smoke → Tasks 3/4 fixtures, Task 7 Step 7 smoke. ✅

**Placeholder scan:** No "TBD"/"handle errors"/"similar to". Two intentional inspect-first notes (ingestion schema columns in Task 7 Step 3; footer markup in Task 8) point at real files with concrete fallback instructions, not vague directives.

**Type consistency:** `FetchText` defined in Task 4, imported by Tasks 5. `Conflict`/`LoadResult` defined in Task 6, consumed by Task 7. `BjjHeroesProfile`/`BjjHeroesRecord` from Task 3 used in Tasks 6. `CreateMatchInput.format`/`sourceRef` from Task 1 used in Task 6. Outcome union `"WON"|"LOST"|"DRAW"` consistent across parse/load; `createMatch` competitor outcome union includes these. Method/matchType unions match the `matches` schema enums from Task 1.

**Note for the implementer:** Task 1 must land before Task 6 (schema), and Task 2/3 before Task 6 (imports). Tasks 2, 3, 4, 5 are independent of each other and can be done in any order.
