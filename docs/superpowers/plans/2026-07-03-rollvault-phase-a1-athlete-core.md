# RollVault Phase A.1 — Athlete Identity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the RollVault project and implement the Athlete identity core — schema, migrations, and a typed, tested write-path with duplicate detection (entity resolution) and provenance — proving the architecture end-to-end on one entity.

**Architecture:** Next.js (App Router) + TypeScript app with Postgres as source of truth, accessed via Drizzle ORM. All writes go through a typed service layer, never direct DB access from UI. Entity-resolution scoring is a pure, dependency-free function (unit-tested in isolation); the service layer combines it with DB queries. Tests run against in-process Postgres (pglite) so they are hermetic and need no Docker.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Drizzle ORM, `postgres` (postgres-js) driver for runtime, `@electric-sql/pglite` for tests, Vitest, Zod for input validation.

## Global Constraints

- Runtime source of truth is **Postgres**; no other database. (spec §3)
- **No hosted media** — athlete data only in this plan; no video/instructional yet. (spec §3)
- Every athlete-fact carries **provenance**: `sourceUrl`, `verifiedBy`, `verifiedAt`, `confidence` (`CONFIRMED` | `NEEDS_REVIEW`). (spec §5)
- Every entity has **draft → published** `status` and never leaks to public when `draft`. (spec §5)
- Every entity has a **UUID primary key + human `slug`** (`/athlete/gordon-ryan`). (spec §4)
- **Entity resolution is first-class**: creating an athlete must surface possible duplicates before insert. (spec §5)
- Writes go through the **typed service layer**, not direct DB pokes from UI/route handlers. (spec §5)
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. (this plan)

---

### Task 1: Project scaffold + test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `.gitignore`, `.env.example`
- Create: `src/lib/health.ts`
- Test: `src/lib/health.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ping(): string` in `src/lib/health.ts` returning `"pong"` — a smoke target proving the toolchain runs.

- [ ] **Step 1: Initialize the project and install dependencies**

Run from repo root (`C:\Coding\Projects\rollvault`):

```bash
npm init -y
npm install next@15 react react-dom drizzle-orm postgres zod
npm install -D typescript @types/node @types/react @types/react-dom \
  drizzle-kit vitest @electric-sql/pglite
```

- [ ] **Step 2: Add config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

`.gitignore`:

```
node_modules
.next
.env
.env.local
*.tsbuildinfo
```

`.env.example`:

```
# Runtime Postgres (Neon or Supabase). Tests use in-process pglite instead.
DATABASE_URL=postgres://user:password@host:5432/rollvault
```

Add scripts to `package.json` (merge into the generated file):

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

- [ ] **Step 3: Write the failing smoke test**

`src/lib/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ping } from "@/lib/health";

describe("ping", () => {
  it("returns pong", () => {
    expect(ping()).toBe("pong");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/health` (module does not exist).

- [ ] **Step 5: Write minimal implementation**

`src/lib/health.ts`:

```ts
export function ping(): string {
  return "pong";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + Drizzle + Vitest toolchain"
```

---

### Task 2: Athlete + AthleteAlias schema and migration

**Files:**
- Create: `src/db/schema/athlete.ts`
- Create: `src/db/schema/index.ts`
- Create: `drizzle.config.ts`
- Test: `src/db/schema/athlete.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `athletes` table with columns: `id` (uuid pk), `slug` (text unique), `fullName` (text), `nationality` (text nullable), `status` (`'draft' | 'published'`, default `'draft'`), `sourceUrl` (text nullable), `verifiedBy` (text nullable), `verifiedAt` (timestamp nullable), `confidence` (`'CONFIRMED' | 'NEEDS_REVIEW'`, default `'NEEDS_REVIEW'`), `createdAt`, `updatedAt`.
  - `athleteAliases` table: `id` (uuid pk), `athleteId` (uuid fk → athletes.id, cascade), `alias` (text).
  - Type exports: `Athlete = typeof athletes.$inferSelect`, `NewAthlete = typeof athletes.$inferInsert`, `AthleteAlias = typeof athleteAliases.$inferSelect`.

- [ ] **Step 1: Write the failing test**

`src/db/schema/athlete.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { athletes, athleteAliases } from "@/db/schema/athlete";
import { getTableColumns } from "drizzle-orm";

describe("athlete schema", () => {
  it("defines the provenance and status columns on athletes", () => {
    const cols = Object.keys(getTableColumns(athletes));
    for (const c of [
      "id", "slug", "fullName", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("links aliases to an athlete", () => {
    const cols = Object.keys(getTableColumns(athleteAliases));
    expect(cols).toContain("athleteId");
    expect(cols).toContain("alias");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test src/db/schema/athlete.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/athlete`.

- [ ] **Step 3: Write the schema**

`src/db/schema/athlete.ts`:

```ts
import {
  pgTable, uuid, text, timestamp, index,
} from "drizzle-orm/pg-core";

export const athletes = pgTable("athletes", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  fullName: text("full_name").notNull(),
  nationality: text("nationality"),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
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
});

export const athleteAliases = pgTable(
  "athlete_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [index("athlete_aliases_athlete_id_idx").on(t.athleteId)],
);

export type Athlete = typeof athletes.$inferSelect;
export type NewAthlete = typeof athletes.$inferInsert;
export type AthleteAlias = typeof athleteAliases.$inferSelect;
```

`src/db/schema/index.ts`:

```ts
export * from "./athlete";
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test src/db/schema/athlete.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Generate the SQL migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` (e.g. `drizzle/0000_*.sql`) creating both tables. Open it and confirm it contains `CREATE TABLE "athletes"` and `CREATE TABLE "athlete_aliases"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add athlete + athlete_aliases schema and initial migration"
```

---

### Task 3: Pure name-normalization and similarity functions

**Files:**
- Create: `src/lib/identity/normalize.ts`
- Create: `src/lib/identity/match.ts`
- Test: `src/lib/identity/normalize.test.ts`
- Test: `src/lib/identity/match.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeName(raw: string): string` — lowercase, trim, collapse whitespace, strip diacritics and punctuation.
  - `slugify(raw: string): string` — normalized, spaces → hyphens, ascii only.
  - `nameSimilarity(a: string, b: string): number` — normalized Levenshtein ratio in `[0, 1]`, compares on `normalizeName` output.
  - `type Candidate = { id: string; name: string; aliases: string[] }`
  - `type ScoredCandidate = { id: string; name: string; score: number }`
  - `findDuplicateCandidates(input: string, candidates: Candidate[], threshold?: number): ScoredCandidate[]` — scores each candidate by the best similarity across its name + aliases, returns those `>= threshold` (default `0.82`), sorted descending by score.

- [ ] **Step 1: Write the failing tests for normalize**

`src/lib/identity/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeName, slugify } from "@/lib/identity/normalize";

describe("normalizeName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeName("  Gordon   Ryan ")).toBe("gordon ryan");
  });
  it("strips diacritics and punctuation", () => {
    expect(normalizeName("André Galvão")).toBe("andre galvao");
    expect(normalizeName("Gordon 'The King' Ryan")).toBe("gordon the king ryan");
  });
});

describe("slugify", () => {
  it("produces a url-safe slug", () => {
    expect(slugify("André Galvão")).toBe("andre-galvao");
    expect(slugify("Gordon Ryan")).toBe("gordon-ryan");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/lib/identity/normalize.test.ts`
Expected: FAIL — cannot resolve `@/lib/identity/normalize`.

- [ ] **Step 3: Implement normalize**

`src/lib/identity/normalize.ts`:

```ts
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")    // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(raw: string): string {
  return normalizeName(raw).replace(/\s/g, "-");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test src/lib/identity/normalize.test.ts`
Expected: PASS (4 assertions across 2 tests).

- [ ] **Step 5: Write the failing tests for match**

`src/lib/identity/match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nameSimilarity, findDuplicateCandidates } from "@/lib/identity/match";

describe("nameSimilarity", () => {
  it("is 1 for identical normalized names", () => {
    expect(nameSimilarity("Gordon Ryan", "gordon  ryan")).toBe(1);
  });
  it("is high for a near match", () => {
    expect(nameSimilarity("Gordon Ryan", "Gordon Ryann")).toBeGreaterThan(0.9);
  });
  it("is low for unrelated names", () => {
    expect(nameSimilarity("Gordon Ryan", "Nicky Rodriguez")).toBeLessThan(0.5);
  });
});

describe("findDuplicateCandidates", () => {
  const candidates = [
    { id: "1", name: "Gordon Ryan", aliases: ["The King"] },
    { id: "2", name: "Nicky Rodriguez", aliases: ["Nicky Rod"] },
  ];

  it("matches on the canonical name", () => {
    const hits = findDuplicateCandidates("gordon ryann", candidates);
    expect(hits[0]?.id).toBe("1");
    expect(hits).toHaveLength(1);
  });

  it("matches on an alias", () => {
    const hits = findDuplicateCandidates("Nicky Rod", candidates);
    expect(hits[0]?.id).toBe("2");
  });

  it("returns empty when nothing clears the threshold", () => {
    expect(findDuplicateCandidates("Roger Gracie", candidates)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test src/lib/identity/match.test.ts`
Expected: FAIL — cannot resolve `@/lib/identity/match`.

- [ ] **Step 7: Implement match**

`src/lib/identity/match.ts`:

```ts
import { normalizeName } from "./normalize";

export type Candidate = { id: string; name: string; aliases: string[] };
export type ScoredCandidate = { id: string; name: string; score: number };

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

export function findDuplicateCandidates(
  input: string,
  candidates: Candidate[],
  threshold = 0.82,
): ScoredCandidate[] {
  return candidates
    .map((c) => {
      const score = Math.max(
        nameSimilarity(input, c.name),
        ...c.aliases.map((alias) => nameSimilarity(input, alias)),
      );
      return { id: c.id, name: c.name, score };
    })
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test src/lib/identity`
Expected: PASS (all normalize + match tests).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add name normalization and duplicate-candidate scoring"
```

---

### Task 4: Test database harness (pglite + migrations)

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/test-db.ts`
- Test: `src/db/test-db.test.ts`

**Interfaces:**
- Consumes: `athletes`, `athleteAliases` from Task 2.
- Produces:
  - `db` (runtime Drizzle client over postgres-js) in `src/db/client.ts`, plus `type Db` = the Drizzle database type shared by runtime and tests.
  - `createTestDb(): Promise<{ db: Db; close: () => Promise<void> }>` in `src/db/test-db.ts` — spins up an in-process pglite database with the schema applied via `drizzle/` migrations, returning a client compatible with the service layer.

- [ ] **Step 1: Write the runtime client**

`src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "";
const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });

export type Db = typeof db | Awaited<
  ReturnType<typeof import("./test-db").createTestDb>
>["db"];
```

Note: `Db` is a union so service functions accept either the runtime client or the pglite test client. Both share the same `schema`, so query methods used in Task 5 are available on both.

- [ ] **Step 2: Write the failing test**

`src/db/test-db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import { athletes } from "@/db/schema/athlete";

describe("createTestDb", () => {
  it("provides a migrated database that can insert and read athletes", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(athletes).values({ slug: "test-user", fullName: "Test User" });
      const rows = await db.select().from(athletes);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.slug).toBe("test-user");
      expect(rows[0]?.status).toBe("draft"); // default applied
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test src/db/test-db.test.ts`
Expected: FAIL — cannot resolve `@/db/test-db`.

- [ ] **Step 4: Implement the pglite test harness**

`src/db/test-db.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export async function createTestDb() {
  const client = new PGlite(); // in-memory
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test src/db/test-db.test.ts`
Expected: PASS. (If migrate fails because no migration exists, confirm Task 2 Step 5 generated `drizzle/0000_*.sql`.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add pglite test database harness with migrations"
```

---

### Task 5: Athlete write-path service (create, search, duplicate check)

**Files:**
- Create: `src/lib/athletes/service.ts`
- Test: `src/lib/athletes/service.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 4), `athletes`/`athleteAliases` (Task 2), `slugify` (Task 3), `findDuplicateCandidates`/`ScoredCandidate` (Task 3).
- Produces:
  - `type CreateAthleteInput = { fullName: string; nationality?: string; aliases?: string[]; sourceUrl?: string; verifiedBy?: string; confidence?: "CONFIRMED" | "NEEDS_REVIEW"; status?: "draft" | "published" }`
  - `findAthleteDuplicates(db: Db, name: string): Promise<ScoredCandidate[]>`
  - `createAthlete(db: Db, input: CreateAthleteInput): Promise<Athlete>` — sets `verifiedAt` when `verifiedBy` is provided, derives a unique `slug` from `fullName` (suffixing `-2`, `-3`… on collision), inserts aliases.
  - `searchAthletes(db: Db, query: string): Promise<{ id: string; fullName: string; slug: string }[]>`

- [ ] **Step 1: Write the failing tests**

`src/lib/athletes/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  createAthlete, findAthleteDuplicates, searchAthletes,
} from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("createAthlete", () => {
  it("creates an athlete with a derived slug and stamps verification", async () => {
    const a = await createAthlete(ctx.db, {
      fullName: "Gordon Ryan",
      verifiedBy: "editor@rollvault",
      confidence: "CONFIRMED",
      sourceUrl: "https://adcombat.com/results",
    });
    expect(a.slug).toBe("gordon-ryan");
    expect(a.confidence).toBe("CONFIRMED");
    expect(a.verifiedAt).not.toBeNull();
  });

  it("disambiguates slug collisions", async () => {
    const a = await createAthlete(ctx.db, { fullName: "John Smith" });
    const b = await createAthlete(ctx.db, { fullName: "John Smith" });
    expect(a.slug).toBe("john-smith");
    expect(b.slug).toBe("john-smith-2");
  });

  it("stores provided aliases", async () => {
    await createAthlete(ctx.db, { fullName: "Nicky Rodriguez", aliases: ["Nicky Rod"] });
    const hits = await findAthleteDuplicates(ctx.db, "Nicky Rod");
    expect(hits[0]?.name).toBe("Nicky Rodriguez");
  });
});

describe("findAthleteDuplicates", () => {
  it("flags a near-duplicate before a second insert", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const hits = await findAthleteDuplicates(ctx.db, "Gordon Ryann");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.score).toBeGreaterThan(0.82);
  });

  it("returns empty for a clearly new name", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    expect(await findAthleteDuplicates(ctx.db, "Roger Gracie")).toEqual([]);
  });
});

describe("searchAthletes", () => {
  it("finds by case-insensitive substring", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const rows = await searchAthletes(ctx.db, "gordon");
    expect(rows[0]?.slug).toBe("gordon-ryan");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/lib/athletes/service.test.ts`
Expected: FAIL — cannot resolve `@/lib/athletes/service`.

- [ ] **Step 3: Implement the service**

`src/lib/athletes/service.ts`:

```ts
import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db/client";
import { athletes, athleteAliases, type Athlete } from "@/db/schema/athlete";
import { slugify } from "@/lib/identity/normalize";
import {
  findDuplicateCandidates, type ScoredCandidate,
} from "@/lib/identity/match";

export type CreateAthleteInput = {
  fullName: string;
  nationality?: string;
  aliases?: string[];
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

async function uniqueSlug(db: Db, fullName: string): Promise<string> {
  const base = slugify(fullName);
  let candidate = base;
  let n = 1;
  // Loop until no row owns the candidate slug.
  while (true) {
    const existing = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(eq(athletes.slug, candidate));
    if (existing.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function findAthleteDuplicates(
  db: Db,
  name: string,
): Promise<ScoredCandidate[]> {
  const rows = await db
    .select({ id: athletes.id, name: athletes.fullName })
    .from(athletes);
  const aliasRows = await db
    .select({ athleteId: athleteAliases.athleteId, alias: athleteAliases.alias })
    .from(athleteAliases);
  const candidates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: aliasRows.filter((a) => a.athleteId === r.id).map((a) => a.alias),
  }));
  return findDuplicateCandidates(name, candidates);
}

export async function createAthlete(
  db: Db,
  input: CreateAthleteInput,
): Promise<Athlete> {
  const slug = await uniqueSlug(db, input.fullName);
  const [athlete] = await db
    .insert(athletes)
    .values({
      slug,
      fullName: input.fullName,
      nationality: input.nationality ?? null,
      status: input.status ?? "draft",
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();

  if (input.aliases?.length) {
    await db.insert(athleteAliases).values(
      input.aliases.map((alias) => ({ athleteId: athlete.id, alias })),
    );
  }
  return athlete;
}

export async function searchAthletes(
  db: Db,
  query: string,
): Promise<{ id: string; fullName: string; slug: string }[]> {
  return db
    .select({ id: athletes.id, fullName: athletes.fullName, slug: athletes.slug })
    .from(athletes)
    .where(ilike(athletes.fullName, `%${query}%`))
    .limit(10);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test src/lib/athletes/service.test.ts`
Expected: PASS (all create/duplicate/search tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all tasks' tests green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add athlete write-path service with duplicate detection"
```

---

### Task 6: Admin API route + minimal athlete-entry UI

**Files:**
- Create: `src/app/api/admin/athletes/route.ts`
- Create: `src/app/api/admin/athletes/duplicates/route.ts`
- Create: `src/app/admin/athletes/new/page.tsx`
- Create: `src/app/admin/athletes/new/athlete-form.tsx`
- Test: `src/app/api/admin/athletes/route.test.ts`

**Interfaces:**
- Consumes: `createAthlete`, `findAthleteDuplicates`, `searchAthletes` (Task 5), `db` (Task 4).
- Produces:
  - `POST /api/admin/athletes` — body validated by Zod (`CreateAthleteSchema`), calls `createAthlete`, returns `201` + the athlete JSON.
  - `GET /api/admin/athletes?q=` — calls `searchAthletes`.
  - `GET /api/admin/athletes/duplicates?name=` — calls `findAthleteDuplicates`, returns scored candidates.
  - `CreateAthleteSchema` (Zod) exported from `route.ts` for reuse by the form.
  - A React client form that, on name blur, calls the duplicates endpoint and renders a "possible duplicates" panel that must be acknowledged before submit is enabled.

- [ ] **Step 1: Write the failing route test**

`src/app/api/admin/athletes/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreateAthleteSchema } from "@/app/api/admin/athletes/route";

describe("CreateAthleteSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreateAthleteSchema.parse({
      fullName: "Gordon Ryan",
      confidence: "CONFIRMED",
    });
    expect(parsed.fullName).toBe("Gordon Ryan");
  });
  it("rejects an empty name", () => {
    expect(() => CreateAthleteSchema.parse({ fullName: "" })).toThrow();
  });
  it("rejects an unknown confidence value", () => {
    expect(() =>
      CreateAthleteSchema.parse({ fullName: "X", confidence: "MAYBE" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test src/app/api/admin/athletes/route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/admin/athletes/route`.

- [ ] **Step 3: Implement the create/search route**

`src/app/api/admin/athletes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createAthlete, searchAthletes } from "@/lib/athletes/service";

export const CreateAthleteSchema = z.object({
  fullName: z.string().min(1),
  nationality: z.string().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateAthleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const athlete = await createAthlete(db, parsed.data);
  return NextResponse.json(athlete, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchAthletes(db, q));
}
```

- [ ] **Step 4: Implement the duplicates route**

`src/app/api/admin/athletes/duplicates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { findAthleteDuplicates } from "@/lib/athletes/service";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!name) return NextResponse.json([]);
  return NextResponse.json(await findAthleteDuplicates(db, name));
}
```

- [ ] **Step 5: Implement the entry page and form**

`src/app/admin/athletes/new/page.tsx`:

```tsx
import { AthleteForm } from "./athlete-form";

export default function NewAthletePage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New athlete</h1>
      <AthleteForm />
    </main>
  );
}
```

`src/app/admin/athletes/new/athlete-form.tsx`:

```tsx
"use client";
import { useState } from "react";

type Dup = { id: string; name: string; score: number };

export function AthleteForm() {
  const [fullName, setFullName] = useState("");
  const [dups, setDups] = useState<Dup[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function checkDuplicates() {
    if (!fullName) return;
    const res = await fetch(
      `/api/admin/athletes/duplicates?name=${encodeURIComponent(fullName)}`,
    );
    const found: Dup[] = await res.json();
    setDups(found);
    setAcknowledged(found.length === 0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName }),
    });
    setResult(res.ok ? "Created" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <label>
        Full name
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onBlur={checkDuplicates}
        />
      </label>

      {dups.length > 0 && (
        <div style={{ border: "1px solid #c00", padding: 8, margin: "8px 0" }}>
          <strong>Possible duplicates:</strong>
          <ul>
            {dups.map((d) => (
              <li key={d.id}>{d.name} ({d.score.toFixed(2)})</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            This is a new, distinct athlete
          </label>
        </div>
      )}

      <button type="submit" disabled={!fullName || !acknowledged}>
        Create
      </button>
      {result && <p>{result}</p>}
    </form>
  );
}
```

- [ ] **Step 6: Run to verify the schema test passes**

Run: `npm test src/app/api/admin/athletes/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Manually verify the UI end-to-end**

Set `DATABASE_URL` in `.env` to a real Postgres (Neon/Supabase free tier), then:

```bash
npm run db:migrate
npm run dev
```

Visit `http://localhost:3000/admin/athletes/new`. Create "Gordon Ryan". Reload the page and start typing "Gordon Ryann", tab out of the field — the duplicates panel must appear and the Create button stays disabled until the acknowledgement box is checked.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add admin athlete-entry UI with duplicate-check gate"
```

---

## Self-Review

**Spec coverage (Phase A.1 subset):**
- UUID + slug per entity → Task 2 (schema), Task 5 (`uniqueSlug`). ✓
- Provenance (`sourceUrl`/`verifiedBy`/`verifiedAt`/`confidence`) → Task 2 (columns), Task 5 (stamping). ✓
- Draft → published status → Task 2 (column, default `draft`), Task 5 (`status`). ✓
- Entity resolution as first-class → Task 3 (scoring), Task 5 (`findAthleteDuplicates`), Task 6 (UI gate). ✓
- Writes through typed service layer, not direct DB → Task 5 service; Task 6 routes call the service only. ✓
- AthleteAlias registry → Task 2 (table), Task 5 (insert + duplicate matching). ✓
- Postgres source of truth; hermetic tests → Task 4 (postgres-js runtime, pglite tests). ✓
- **Out of scope (correctly deferred to later Phase A sub-plans):** Match, Event, Promotion, Team, Placement, temporal membership, change_log audit, public pages, search UI. These are named for follow-on plans, not gaps.

**Placeholder scan:** No TBD/TODO; every code step contains complete code and exact run commands with expected output. ✓

**Type consistency:** `Db` (Task 4) is consumed by every Task 5 signature; `ScoredCandidate`/`Candidate`/`findDuplicateCandidates` names match between Task 3 and Task 5; `CreateAthleteInput` fields align with `CreateAthleteSchema` (Task 6); `slugify` (Task 3) used by `uniqueSlug` (Task 5). ✓

---

## Follow-on plans (not this plan)

- **Phase A.2** — Promotion + Event + Match + MatchCompetitor + Placement schema and services (the results core), reusing the entity-resolution + provenance + draft/publish patterns established here.
- **Phase A.3** — Team + temporal AthleteTeamMembership; `change_log` audit table; event-centric entry flow.
- **Phase B** — public server-rendered pages + search + video/instructional secondary layer.

## Deferred from final whole-branch review (2026-07-04)

Findings from the final review that were consciously deferred rather than fixed on this
branch (fix #4 normalization + #9 metadata were applied — commit 9742f03):

- **Server-enforced duplicate gate (Important).** The duplicate-check gate is UI-only;
  `POST /api/admin/athletes` → `createAthlete` performs no server-side duplicate check, so a
  direct API caller can create duplicates. Matches the plan as written. Add a server guard
  (route/service calls `findAthleteDuplicates`, rejects or requires an explicit
  `overrideDuplicates` flag when candidates exist) — do this before any non-form write path
  or Phase A.2.
- **Admin authentication (Important).** No auth on `/admin/*` or `/api/admin/*` (spec §3
  wants `is_editor`). Must land before any public/shared deployment — Phase B blocker.
- **Route-handler integration tests (Important).** `route.test.ts` only tests the Zod
  schema; the POST/GET 201/400 contract is untested because the handler imports the `db`
  singleton. Refactor to inject `db` (factory) and add pglite-backed handler tests.
- **Provenance not enforced for CONFIRMED (Minor).** `confidence: "CONFIRMED"` is accepted
  with no `sourceUrl`/`verifiedBy`. Add a rule that CONFIRMED requires a source.
- **Other minors:** `uniqueSlug` + create/aliases are check-then-insert / two-statement
  (TOCTOU race + orphan-on-failure) — wrap in a transaction when concurrency matters;
  `searchAthletes` passes `%`/`_` through as LIKE wildcards; `updatedAt` has no auto-bump;
  `findAthleteDuplicates` loads all athletes+aliases per check (fine at ~150–200, needs a
  DB-side trigram/FTS prefilter later).
