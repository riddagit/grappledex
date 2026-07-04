# Grappledex Phase B.4 — Sitemap + robots (Design)

**Date:** 2026-07-04
**Status:** Proposed.
**Depends on:** B.1–B.3 (public read layer + all entity routes exist).
**Parent:** `2026-07-04-grappledex-phase-b-public-pages-design.md` §6, §7 (B.4).

---

## 1. Why

B.3 completed the public route set. The SEO baseline (§6) is otherwise done — every page
already server-renders with clean slugs, per-page metadata/OpenGraph, and structured data
(`Person`, `SportsEvent`). The only missing pieces are the crawl-surface files: a
`sitemap.xml` enumerating every public URL and a `robots.txt` pointing crawlers at it while
keeping them out of the private surface. This closes Phase B.

## 2. Base URL

All absolute URLs derive from a single origin read from `process.env.NEXT_PUBLIC_SITE_URL`,
falling back to `https://grappledex.com` (placeholder — **user to confirm the production
domain**; changing the env var is the only action needed, no code change). One helper,
`siteUrl(path)`, joins origin + path so sitemap and robots stay consistent.

## 3. Enumeration (read layer)

New `src/lib/public/sitemap.ts` — `listPublicUrls(db)` returns every public path with a
`lastModified` where available, published-only:

- `/` (landing) — no lastModified.
- `/athlete/{slug}`, `/event/{slug}`, `/promotion/{slug}`, `/team/{slug}` — from each
  entity's published rows, `lastModified` = `updatedAt`.
- `/match/{id}` — published matches **on published events only** (mirrors `getMatchPage`'s
  visibility rule), `lastModified` = match `updatedAt`.

Returns `{ path: string; lastModified?: Date }[]`. Pure, pglite-testable against the seed.

## 4. Routes

- `src/app/sitemap.ts` — `MetadataRoute.Sitemap`, `dynamic = "force-dynamic"` (hits DB).
  Maps `listPublicUrls(db)` → `{ url: siteUrl(path), lastModified }`.
- `src/app/robots.ts` — `MetadataRoute.Robots`: allow `/`, disallow `/admin/` and `/api/`,
  `sitemap: siteUrl("/sitemap.xml")`.

## 5. Testing

- `sitemap.test.ts`: seed → assert the landing plus one URL per published entity and per
  published match are present; assert a draft entity's URL is **absent**; assert a match on
  a draft event is absent.
- `siteUrl` unit test: joins origin + path without double slashes; honours the env override.
- Build stays green; `sitemap.ts`/`robots.ts` type-check as valid `MetadataRoute` exports.

## 6. Out of scope

Per-entity `changeFrequency`/`priority` tuning, image sitemaps, i18n alternates, pagination
of very large sitemaps (revisit when the corpus outgrows a single 50k-URL file).
