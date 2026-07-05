# URL Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin submit a URL instead of pasted text; the system fetches the page, extracts its main article body, and feeds that text into the existing extract → resolve → review → commit pipeline unchanged.

**Architecture:** One new mockable seam, `PageFetcher`, turns a URL into readable text (mirroring the existing `Extractor` seam so CI needs no network). It is composed of three focused, independently-testable units: `assertSafeUrl` (SSRF guard, pure), `extractReadable` (HTML → text via Readability, pure), and `fetchUrl` (network, injectable `fetch`). The URL is stored on the batch in a new `source_url` column and flows to every committed row's `sourceUrl` provenance. The whole downstream pipeline is untouched.

**Tech Stack:** Next.js 15 (Node runtime route handlers), Drizzle + Postgres (pglite in tests), Vitest, Zod v4, `@mozilla/readability` + `jsdom` (new deps).

## Global Constraints

- Tests: `npm test` runs `vitest run`. Run individual files with `npx vitest run <path>`.
- Type + build gates before any merge: `npx tsc --noEmit` and `npm run build` must be clean.
- Path alias: `@/` → `src/`.
- Test DB: `createTestDb()` from `@/db/test-db` spins an in-memory PGlite and applies real migrations from `./drizzle`. Any schema change needs a generated migration for tests to see the column.
- Ingest routes run on the Node runtime (no `runtime` export) — required by jsdom. Do not add `export const runtime = "edge"`.
- Follow the existing `Extractor` pattern in `src/lib/ingestion/extract.ts`: interface + `Fake*` test double + real impl; the route constructs the real impl directly (no DI test on the route handler exists, and none is added).
- ESM project (`"type": "module"`); all imports use explicit `@/…` or relative paths.
- Migration numbering continues from `0012`; the next generated file is `0013_*.sql`.

---

### Task 1: SSRF guard — `assertSafeUrl`

**Files:**
- Create: `src/lib/ingestion/url-safety.ts`
- Test: `src/lib/ingestion/url-safety.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assertSafeUrl(raw: string): URL` — returns a parsed `URL` on success, throws `Error` on unsafe/invalid input.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ingestion/url-safety.test.ts
import { describe, it, expect } from "vitest";
import { assertSafeUrl } from "./url-safety";

describe("assertSafeUrl", () => {
  it("accepts a normal public http(s) URL and returns a URL", () => {
    const url = assertSafeUrl("https://en.wikipedia.org/wiki/ADCC");
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe("en.wikipedia.org");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertSafeUrl("ftp://example.com/x")).toThrow(/scheme/i);
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(/scheme/i);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertSafeUrl("not a url")).toThrow(/invalid url/i);
  });

  it("rejects loopback and localhost", () => {
    expect(() => assertSafeUrl("http://localhost/x")).toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1/x")).toThrow();
    expect(() => assertSafeUrl("http://[::1]/x")).toThrow();
  });

  it("rejects private and link-local IPv4 ranges", () => {
    expect(() => assertSafeUrl("http://10.0.0.5/x")).toThrow();
    expect(() => assertSafeUrl("http://172.16.4.4/x")).toThrow();
    expect(() => assertSafeUrl("http://192.168.1.1/x")).toThrow();
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/url-safety.test.ts`
Expected: FAIL — cannot resolve `./url-safety`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ingestion/url-safety.ts
/**
 * SSRF guard for admin URL ingestion. The admin surface is currently
 * unauthenticated, so this is load-bearing, not defense-in-depth. It is a
 * pragmatic scheme + host/IP-literal baseline and does NOT defend against DNS
 * rebinding (a hostname that resolves to a private IP after this check).
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Refusing to fetch a loopback host");
  }
  if (isPrivateAddress(host)) {
    throw new Error("Refusing to fetch a private, loopback, or link-local address");
  }
  return url;
}

function isPrivateAddress(host: string): boolean {
  if (host.includes(":")) {
    // IPv6 literal (URL.hostname strips the surrounding brackets).
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7 ULA
    if (host.startsWith("fe80")) return true; // link-local
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host);
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;            // "this" network, loopback
  if (a === 10) return true;                         // private
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 169 && b === 254) return true;           // link-local / cloud metadata
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/url-safety.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/url-safety.ts src/lib/ingestion/url-safety.test.ts
git commit -m "feat(ingest): add assertSafeUrl SSRF guard for URL fetching"
```

---

### Task 2: HTML → readable text — `extractReadable`

**Files:**
- Create: `src/lib/ingestion/readable.ts`
- Test: `src/lib/ingestion/readable.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `@mozilla/readability`, `jsdom`.
- Produces: `interface ReadableResult { text: string; title?: string }` and `extractReadable(html: string, baseUrl: string): ReadableResult`.

- [ ] **Step 1: Install the parsing dependencies**

Run:
```bash
npm install @mozilla/readability jsdom
npm install -D @types/jsdom
```
Expected: `@mozilla/readability` and `jsdom` appear under `dependencies`, `@types/jsdom` under `devDependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/ingestion/readable.test.ts
import { describe, it, expect } from "vitest";
import { extractReadable } from "./readable";

// A realistically-sized article so Readability engages (its char threshold is ~500).
const body = "Gordon Ryan submitted every opponent on his way to gold at ADCC 2022. ".repeat(12);
const articleHtml = `<!DOCTYPE html><html><head><title>ADCC 2022 Recap</title></head>
<body>
  <nav>HOME ABOUT CONTACT SUBSCRIBE NEWSLETTER</nav>
  <article><h1>ADCC 2022 Recap</h1><p>${body}</p></article>
  <footer>Copyright 2022 SomeSite. All rights reserved. Privacy policy.</footer>
</body></html>`;

describe("extractReadable", () => {
  it("returns the main article body and title, dropping nav/footer boilerplate", () => {
    const { text, title } = extractReadable(articleHtml, "https://example.com/adcc");
    expect(text).toContain("Gordon Ryan submitted every opponent");
    expect(text).not.toContain("SUBSCRIBE");
    expect(text).not.toContain("Privacy policy");
    expect(title).toMatch(/ADCC 2022 Recap/);
  });

  it("falls back to body text when there is no article-worthy content", () => {
    const { text } = extractReadable(
      "<html><head><title>Tiny</title></head><body><p>just a stub</p></body></html>",
      "https://example.com",
    );
    expect(text).toContain("just a stub");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/readable.test.ts`
Expected: FAIL — cannot resolve `./readable`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/ingestion/readable.ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ReadableResult {
  text: string;
  title?: string;
}

/**
 * Pure HTML → readable text. Mozilla Readability isolates the main article body
 * (dropping nav/ads/footer); when it finds no article we fall back to the plain
 * body text. No network — unit-testable with HTML strings.
 */
export function extractReadable(html: string, baseUrl: string): ReadableResult {
  // Readability mutates its document, so parse it on a dedicated DOM.
  const dom = new JSDOM(html, { url: baseUrl });
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent && article.textContent.trim()) {
    return {
      text: normalizeWhitespace(article.textContent),
      title: article.title?.trim() || undefined,
    };
  }
  // Fallback on a fresh DOM (the one above was mutated by Readability).
  const doc = new JSDOM(html).window.document;
  return {
    text: normalizeWhitespace(doc.body?.textContent ?? ""),
    title: doc.title?.trim() || undefined,
  };
}

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/readable.test.ts`
Expected: PASS (2 tests). If the first test unexpectedly hits the fallback (Readability declined), lengthen `body`'s repeat count until the article path engages — do not weaken the boilerplate assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingestion/readable.ts src/lib/ingestion/readable.test.ts package.json package-lock.json
git commit -m "feat(ingest): add extractReadable HTML-to-text via Readability+jsdom"
```

---

### Task 3: Network fetch + `PageFetcher` seam

**Files:**
- Create: `src/lib/ingestion/fetch.ts`
- Test: `src/lib/ingestion/fetch.test.ts`

**Interfaces:**
- Consumes: `assertSafeUrl` (Task 1), `extractReadable` + `ReadableResult` (Task 2).
- Produces:
  - `interface PageFetcher { fetch(url: string): Promise<ReadableResult> }`
  - `class FakePageFetcher implements PageFetcher` — constructor `(result: ReadableResult)`, returns it ignoring the URL.
  - `interface FetchDeps { fetch: typeof fetch }`
  - `fetchUrl(rawUrl: string, deps?: FetchDeps): Promise<string>` — returns raw HTML; enforces guard/timeout/size/content-type.
  - `class HttpPageFetcher implements PageFetcher` — constructor `(deps?: FetchDeps)`, composes `fetchUrl` + `extractReadable`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ingestion/fetch.test.ts
import { describe, it, expect } from "vitest";
import { FakePageFetcher, HttpPageFetcher, fetchUrl, type FetchDeps } from "./fetch";

function stubFetch(res: Response): FetchDeps {
  return { fetch: async () => res };
}

const htmlHeaders = { "content-type": "text/html; charset=utf-8" };

describe("FakePageFetcher", () => {
  it("returns its preset result and satisfies PageFetcher", async () => {
    const f = new FakePageFetcher({ text: "hello", title: "T" });
    expect(await f.fetch("https://ignored.example")).toEqual({ text: "hello", title: "T" });
  });
});

describe("fetchUrl", () => {
  it("returns the HTML body for a good HTML response", async () => {
    const res = new Response("<html><body>ok</body></html>", { headers: htmlHeaders });
    const html = await fetchUrl("https://example.com/a", stubFetch(res));
    expect(html).toContain("<body>ok</body>");
  });

  it("rejects a non-HTML content-type", async () => {
    const res = new Response("{}", { headers: { "content-type": "application/json" } });
    await expect(fetchUrl("https://example.com/a", stubFetch(res))).rejects.toThrow(/content-type/i);
  });

  it("rejects a response larger than the cap via content-length", async () => {
    const res = new Response("x", {
      headers: { ...htmlHeaders, "content-length": String(6 * 1024 * 1024) },
    });
    await expect(fetchUrl("https://example.com/a", stubFetch(res))).rejects.toThrow(/too large/i);
  });

  it("rejects a non-2xx response", async () => {
    const res = new Response("nope", { status: 404, statusText: "Not Found", headers: htmlHeaders });
    await expect(fetchUrl("https://example.com/a", stubFetch(res))).rejects.toThrow(/404/);
  });

  it("applies the SSRF guard before fetching", async () => {
    let called = false;
    const deps: FetchDeps = { fetch: async () => { called = true; return new Response(""); } };
    await expect(fetchUrl("http://127.0.0.1/x", deps)).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe("HttpPageFetcher", () => {
  it("fetches then extracts readable text", async () => {
    const body = "Gordon Ryan won ADCC 2022 in dominant fashion. ".repeat(15);
    const res = new Response(
      `<html><head><title>Recap</title></head><body><article><p>${body}</p></article></body></html>`,
      { headers: htmlHeaders },
    );
    const f = new HttpPageFetcher(stubFetch(res));
    const { text } = await f.fetch("https://example.com/recap");
    expect(text).toContain("Gordon Ryan won ADCC 2022");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/fetch.test.ts`
Expected: FAIL — cannot resolve `./fetch`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ingestion/fetch.ts
import { assertSafeUrl } from "./url-safety";
import { extractReadable, type ReadableResult } from "./readable";

export interface PageFetcher {
  fetch(url: string): Promise<ReadableResult>;
}

/** Test double: returns a preset result, ignoring the URL. Mirrors FakeExtractor. */
export class FakePageFetcher implements PageFetcher {
  constructor(private readonly result: ReadableResult) {}
  async fetch(): Promise<ReadableResult> {
    return this.result;
  }
}

export interface FetchDeps {
  fetch: typeof fetch;
}

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "GrappledexIngestBot/1.0 (+https://grappledex.com)";

/**
 * Network fetch with SSRF guard, timeout, size cap, and content-type check.
 * Returns the raw HTML string. `fetch` is injectable for tests.
 */
export async function fetchUrl(rawUrl: string, deps: FetchDeps = { fetch }): Promise<string> {
  const url = assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await deps.fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unexpected content-type: ${contentType || "(none)"}`);
  }
  return readCapped(res, MAX_BYTES);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new Error(`Response too large: ${declared} bytes`);
  }
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Response too large");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response too large (> ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Real fetcher: guarded network fetch → Readability extraction. */
export class HttpPageFetcher implements PageFetcher {
  constructor(private readonly deps: FetchDeps = { fetch }) {}
  async fetch(url: string): Promise<ReadableResult> {
    const html = await fetchUrl(url, this.deps);
    return extractReadable(html, url);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/fetch.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/fetch.ts src/lib/ingestion/fetch.test.ts
git commit -m "feat(ingest): add PageFetcher seam with guarded HttpPageFetcher"
```

---

### Task 4: `source_url` column + provenance wiring (migration 0013)

**Files:**
- Modify: `src/db/schema/ingestion.ts` (add column)
- Modify: `src/lib/ingestion/service.ts` (`createBatch` input, `commitBatch` provenance)
- Modify: `src/lib/ingestion/service.test.ts` (add provenance test)
- Create: `drizzle/0013_*.sql` (generated)

**Interfaces:**
- Consumes: `createBatch` (existing), `commitBatch` (existing).
- Produces: `createBatch` input type gains optional `sourceUrl?: string`; `ingestionBatches` gains `sourceUrl` (`source_url`); commit provenance `sourceUrl` = `batch.sourceUrl ?? batch.sourceNote`.

- [ ] **Step 1: Write the failing test**

Add this test to `src/lib/ingestion/service.test.ts` (reuse the file's existing `graph`, `createTestDb`, and imports; add any missing imports shown):

```ts
// add near the other describe blocks in src/lib/ingestion/service.test.ts
import { athletes } from "@/db/schema/athlete"; // already imported in this file

describe("commitBatch provenance from sourceUrl", () => {
  it("carries the batch sourceUrl into created rows' sourceUrl", async () => {
    const url = "https://example.com/adcc-2022-recap";
    const batch = await createBatch(ctx.db, { sourceText: "ignored", sourceUrl: url });
    await runExtraction(ctx.db, new FakeExtractor(graph), batch.id);

    const loaded = await getBatch(ctx.db, batch.id);
    for (const c of loaded!.candidates) {
      await setDecision(ctx.db, c.id, "accept");
    }
    await commitBatch(ctx.db, batch.id);

    const [gordon] = await ctx.db
      .select()
      .from(athletes)
      .where(eq(athletes.fullName, "Gordon Ryan"));
    expect(gordon.sourceUrl).toBe(url);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ingestion/service.test.ts`
Expected: FAIL — `createBatch` rejects `sourceUrl` (type error) or `gordon.sourceUrl` is `null` (provenance falls back to `sourceNote`, which is unset).

- [ ] **Step 3: Add the schema column**

In `src/db/schema/ingestion.ts`, add `sourceUrl` right after `sourceNote` in `ingestionBatches`:

```ts
  sourceText: text("source_text").notNull(),
  sourceNote: text("source_note"),
  sourceUrl: text("source_url"),
  createdBy: text("created_by"),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0013_*.sql` adding `source_url` to `ingestion_batches`, and an updated snapshot in `drizzle/meta/`.

- [ ] **Step 5: Wire `createBatch` and `commitBatch`**

In `src/lib/ingestion/service.ts`, extend the `createBatch` input type and insert:

```ts
export async function createBatch(
  db: Db,
  input: { sourceText: string; sourceNote?: string; sourceUrl?: string; createdBy?: string },
): Promise<IngestionBatch> {
  const rows = await db
    .insert(ingestionBatches)
    .values({
      sourceText: input.sourceText,
      sourceNote: input.sourceNote ?? null,
      sourceUrl: input.sourceUrl ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
```

Then update the provenance object in `commitBatch` so the URL wins over the free-text note:

```ts
  const provenance = {
    status: "draft" as const,
    confidence: "NEEDS_REVIEW" as const,
    verifiedBy: batch.createdBy ?? undefined,
    sourceUrl: batch.sourceUrl ?? batch.sourceNote ?? undefined,
  };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/ingestion/service.test.ts`
Expected: PASS (existing tests + the new provenance test).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/ingestion.ts src/lib/ingestion/service.ts src/lib/ingestion/service.test.ts drizzle/
git commit -m "feat(ingest): add source_url batch column and commit provenance (migration 0013)"
```

---

### Task 5: Route + validation — accept exactly one of `sourceText` / `sourceUrl`

**Files:**
- Modify: `src/app/api/admin/ingest/validation.ts`
- Modify: `src/app/api/admin/ingest/validation.test.ts`
- Modify: `src/app/api/admin/ingest/route.ts`

**Interfaces:**
- Consumes: `HttpPageFetcher` (Task 3), `createBatch` w/ `sourceUrl` (Task 4).
- Produces: `IngestSchema` now accepts `{ sourceText }` **or** `{ sourceUrl }` (plus optional `sourceNote`), exactly one; route handles URL mode.

- [ ] **Step 1: Write the failing validation test**

Replace the first test in `src/app/api/admin/ingest/validation.test.ts` and add URL cases:

```ts
  it("accepts exactly one of sourceText or sourceUrl", () => {
    expect(IngestSchema.safeParse({ sourceText: "hi" }).success).toBe(true);
    expect(IngestSchema.safeParse({ sourceUrl: "https://example.com/a" }).success).toBe(true);
    expect(IngestSchema.safeParse({ sourceText: "" }).success).toBe(false);
    expect(IngestSchema.safeParse({ sourceUrl: "not-a-url" }).success).toBe(false);
    expect(IngestSchema.safeParse({}).success).toBe(false);
    expect(
      IngestSchema.safeParse({ sourceText: "hi", sourceUrl: "https://example.com/a" }).success,
    ).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/admin/ingest/validation.test.ts`
Expected: FAIL — current schema requires `sourceText` and ignores `sourceUrl`.

- [ ] **Step 3: Update the schema**

Rewrite `src/app/api/admin/ingest/validation.ts`:

```ts
import { z } from "zod";

export const IngestSchema = z
  .object({
    sourceText: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    sourceNote: z.string().optional(),
  })
  .refine(
    (v) => (v.sourceText === undefined) !== (v.sourceUrl === undefined),
    { message: "Provide exactly one of sourceText or sourceUrl" },
  );

export const DecisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["pending", "accept", "merge", "reject"]),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/admin/ingest/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Handle URL mode in the route**

Rewrite `src/app/api/admin/ingest/route.ts` so URL mode fetches before creating the batch:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createBatch, runExtraction, getBatch } from "@/lib/ingestion/service";
import { ClaudeExtractor } from "@/lib/ingestion/extract";
import { HttpPageFetcher } from "@/lib/ingestion/fetch";
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

  let sourceText: string;
  let sourceUrl: string | undefined;
  if (parsed.data.sourceUrl) {
    try {
      const page = await new HttpPageFetcher().fetch(parsed.data.sourceUrl);
      sourceText = page.text;
      sourceUrl = parsed.data.sourceUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch URL";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    if (!sourceText.trim()) {
      return NextResponse.json({ error: "Fetched page had no readable text" }, { status: 502 });
    }
  } else {
    sourceText = parsed.data.sourceText!;
  }

  const batch = await createBatch(db, {
    sourceText,
    sourceUrl,
    sourceNote: parsed.data.sourceNote,
  });
  try {
    await runExtraction(db, new ClaudeExtractor(), batch.id);
  } catch {
    return NextResponse.json(await getBatch(db, batch.id), { status: 502 });
  }
  return NextResponse.json(await getBatch(db, batch.id), { status: 201 });
}
```

- [ ] **Step 6: Verify types and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/ingest/validation.ts src/app/api/admin/ingest/validation.test.ts src/app/api/admin/ingest/route.ts
git commit -m "feat(ingest): accept a source URL in the ingest route (fetch then extract)"
```

---

### Task 6: UI — Paste / Fetch-URL toggle

**Files:**
- Modify: `src/app/admin/ingest/ingest-form.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/ingest` accepting `{ sourceUrl }` or `{ sourceText }` + optional `sourceNote` (Task 5).
- Produces: no exported API change; UI behavior only.

- [ ] **Step 1: Rewrite the form with a mode toggle**

Replace `src/app/admin/ingest/ingest-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "text" | "url";

export function IngestForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = mode === "text" ? sourceText.trim().length > 0 : sourceUrl.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const payload =
      mode === "text"
        ? { sourceText, sourceNote: sourceNote || undefined }
        : { sourceUrl: sourceUrl.trim(), sourceNote: sourceNote || undefined };
    const res = await fetch("/api/admin/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.toString?.() ?? data?.batch?.error ?? "Extraction failed");
      return;
    }
    router.push(`/admin/ingest/${data.batch.id}`);
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: "flex", gap: 16, margin: "8px 0" }}>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "text"}
            onChange={() => setMode("text")}
          />{" "}
          Paste text
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "url"}
            onChange={() => setMode("url")}
          />{" "}
          Fetch URL
        </label>
      </div>

      <label style={{ display: "block", margin: "8px 0" }}>
        Source note (optional)
        <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} style={{ width: "100%" }} />
      </label>

      {mode === "text" ? (
        <label style={{ display: "block", margin: "8px 0" }}>
          Pasted text
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={16}
            style={{ width: "100%" }}
          />
        </label>
      ) : (
        <label style={{ display: "block", margin: "8px 0" }}>
          Source URL
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            style={{ width: "100%" }}
          />
        </label>
      )}

      <button type="submit" disabled={busy || !ready}>
        {busy ? (mode === "url" ? "Fetching…" : "Extracting…") : "Extract"}
      </button>
      {error && <p style={{ color: "#c00" }}>{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Verify build and types**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/ingest/ingest-form.tsx
git commit -m "feat(ingest): add Paste/Fetch-URL toggle to the ingest form"
```

---

### Task 7: Full verification + merge

**Files:** none (verification only).

- [ ] **Step 1: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests pass (existing 160 + new ones), tsc clean, build clean.

- [ ] **Step 2: Manual smoke (optional, needs a running dev DB + ANTHROPIC_API_KEY)**

Run: `npm run dev`, open `/admin/ingest`, choose **Fetch URL**, paste a real article URL, submit. Expect to land on the review page with extracted candidates. (Requires the same live API key the paste path needs; skip if unavailable — the seam is fully unit-tested.)

- [ ] **Step 3: Merge the branch**

```bash
git checkout main
git merge --no-ff phase-d-url-ingestion -m "Merge branch 'phase-d-url-ingestion': URL ingestion via PageFetcher seam"
git branch -d phase-d-url-ingestion
```

Do NOT push. Report status and await explicit OK to push (per project working style).

---

## Self-Review

**Spec coverage:**
- PageFetcher seam + Fake/Http + fetchUrl/extractReadable split → Tasks 1–3. ✓
- Dependency choice (Readability + jsdom) → Task 2. ✓
- SSRF guard (`assertSafeUrl`, schemes + private ranges, documented DNS-rebinding gap) → Task 1. ✓
- Timeout / size cap / content-type → Task 3. ✓
- Exactly-one-of `sourceText`/`sourceUrl` validation → Task 5. ✓
- Route URL mode (fetch → createBatch → runExtraction; 502 on fetch failure, no batch row) → Task 5. ✓
- `source_url` column + migration 0013 + provenance `sourceUrl ?? sourceNote` → Task 4. ✓
- UI Paste/Fetch-URL toggle → Task 6. ✓
- Testing plan (guard, readable, fetch, validation, provenance) → Tasks 1–5. ✓
- Out-of-scope items are not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ReadableResult` defined in Task 2, consumed by name in Task 3; `FetchDeps`/`fetchUrl`/`PageFetcher`/`HttpPageFetcher`/`FakePageFetcher` signatures match across Tasks 3 and 5; `createBatch` `sourceUrl?` added in Task 4 and used in Task 5; provenance field name `sourceUrl` matches `athletes.sourceUrl` (column `source_url`) asserted in Task 4. ✓
