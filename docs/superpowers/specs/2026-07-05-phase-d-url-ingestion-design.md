# Phase D increment — URL ingestion (design)

Date: 2026-07-05
Status: approved, ready for implementation plan

## Goal

Let an admin submit a **URL** instead of pasting raw text. The system fetches the
page, extracts its main article body, and feeds that text into the **existing**
paste → extract → resolve → review → commit pipeline, unchanged. The URL flows
through as provenance so every committed row records its `sourceUrl`.

This is a coverage increment on Phase D assisted ingestion. It reuses `runExtraction`,
`resolveCandidates`, `commitBatch`, and the whole review UI as-is.

## Non-goals (still deferred)

- Per-site connectors / scrapers tuned to specific sources.
- PDF or other non-HTML content types.
- Multiple URLs per batch (single URL per submission in v1).
- JS-rendered pages (no headless browser; we fetch static HTML only).
- Auto-publish (ingest still writes drafts / `NEEDS_REVIEW`, as today).

## Architecture — one new seam

The entire downstream is untouched: `runExtraction` still reads `batch.sourceText`.
URL ingestion adds exactly one step — turn a URL into that text — behind a mockable
interface that mirrors the existing `Extractor` seam, so CI/tests need no network.

```ts
export interface PageFetcher {
  fetch(url: string): Promise<{ text: string; title?: string }>;
}

// Test double: returns preset text, ignores the URL. Mirrors FakeExtractor.
export class FakePageFetcher implements PageFetcher { /* ... */ }

// Real implementation: SSRF guard → network fetch → readability parse.
export class HttpPageFetcher implements PageFetcher { /* ... */ }
```

`HttpPageFetcher` is composed of two independently-testable pieces so the pure logic
can be unit-tested without a network or a fixtures server:

- **`fetchUrl(url, deps?)`** — network only. Runs `assertSafeUrl`, then `fetch` with a
  10s `AbortController` timeout, a ~5 MB response size cap, a descriptive `User-Agent`,
  and a required HTML-ish content-type (`text/html` / `application/xhtml+xml`). Returns
  the raw HTML string. `fetch` is injectable (`deps.fetch`) so tests stub it.
- **`extractReadable(html, baseUrl)`** — pure, no network. Uses `@mozilla/readability`
  over a `jsdom` DOM to pull the main article body (dropping nav, ads, footer) and
  returns `{ text, title }`. If Readability yields no article, it falls back to a plain
  tag-strip of the body text. Being pure, it is fully unit-testable by passing HTML
  strings.

### Dependency choice

`@mozilla/readability` + `jsdom`. jsdom is heavyish, but this is a low-volume,
server-only admin tool where extraction reliability matters more than bundle size, and
Readability is the battle-tested content-extraction path. The ingest route already runs
on the Node runtime (no `runtime` override), which jsdom requires. `linkedom` is the
lighter fallback if jsdom ever causes trouble; not used in v1.

## Security — SSRF guard (load-bearing)

The admin surface currently has **no auth guard** (pre-existing condition, out of scope
here), so a server route that fetches arbitrary URLs is a real SSRF vector. The guard is
therefore a first-class requirement, not defense-in-depth.

`assertSafeUrl(url)` — a pure helper that:
- allows only `http` and `https` schemes;
- rejects loopback / private / link-local / cloud-metadata ranges: `127.0.0.0/8`,
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`,
  and `localhost`.

This is a pragmatic scheme + host/IP-literal baseline. It does **not** defend against
DNS rebinding (a hostname that resolves to a private IP after the check). That residual
risk is accepted for v1 and documented here; closing it would require resolving DNS and
pinning the connection to the vetted IP.

## Request / route flow

Extend `IngestSchema` to accept **exactly one of**:
- `sourceText` — paste mode, unchanged; or
- `sourceUrl` — new URL mode.

Validation enforces exactly-one-of (both present or both absent → 400).

In `POST /api/admin/ingest`:
- **Paste mode** (has `sourceText`): unchanged from today.
- **URL mode** (has `sourceUrl`):
  1. `const { text, title } = await fetcher.fetch(sourceUrl)`.
  2. `createBatch({ sourceText: text, sourceUrl, sourceNote })`.
  3. Existing `runExtraction(db, new ClaudeExtractor(), batch.id)`.
  4. On fetch failure → **502** with `{ error }`, surfaced inline in the form. No batch
     row is created on fetch failure (acceptable for v1; paste behavior is unaffected).

The `PageFetcher` is injected at the route the same way `ClaudeExtractor` is, so tests
use `FakePageFetcher`.

## Data model

Add a nullable **`source_url`** column to `ingestion_batches` (migration **0013**).

Provenance in `commitBatch` becomes `sourceUrl: batch.sourceUrl ?? batch.sourceNote`, so:
- `sourceNote` stays a genuine free-text note, usable in both paste and URL modes;
- the fetched URL gets its own clean, structured field and reaches every committed row's
  `sourceUrl` provenance.

`createBatch`'s input type gains an optional `sourceUrl?: string`.

## UI

The ingest form gains a small **Paste text / Fetch URL** toggle:
- Paste mode: today's textarea (+ optional source note).
- URL mode: a URL input (+ optional source note). Submit posts `{ sourceUrl, sourceNote }`.

On success both modes land on the same `/admin/ingest/[id]` review page that exists today.
Fetch/extraction errors render inline exactly as paste errors do now.

## Testing (TDD)

- **`assertSafeUrl`** — rejects non-http(s) schemes, loopback, each private range, and
  `localhost`; accepts a normal public URL.
- **`extractReadable`** — extracts main-article text from sample HTML (ignoring nav/footer
  boilerplate) and returns a title; falls back to tag-strip when there is no article.
- **`fetchUrl`** — with an injected `fetch` stub: enforces timeout, size cap, and
  content-type; passes through good HTML. No real network.
- **Route validation** — `IngestSchema` accepts exactly one of `sourceText` / `sourceUrl`;
  rejects both/neither.
- **Provenance** — a committed URL batch carries `sourceUrl` into created rows' provenance.
- Existing extract/resolve/commit tests remain green unchanged.

## Rollout

Deploy needs `npm run db:migrate` (migration 0013). New runtime dep: `@mozilla/readability`
+ `jsdom`. No API-key requirement beyond the existing extraction path; the fetcher seam is
stubbed in CI via `FakePageFetcher`.
