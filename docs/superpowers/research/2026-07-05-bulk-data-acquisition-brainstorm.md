# Bulk data acquisition — brainstorm notes (WIP, PAUSED)

**Date:** 2026-07-05
**Status:** 🟡 In-progress brainstorm, **paused mid-session**. This is NOT an approved
design/spec yet — it's a decision + research log so we can resume without redoing the work.
Next session: finish the clarifying questions → propose approaches → write the real spec.

---

## The vision (user's words)

> "find a large database of grapplers, get all the information about them and their stats,
> scrape that into our DB, then scrape YouTube and find the matches, then scrape elsewhere
> to get links to their instructionals."

## Reality check established

There is **no single clean "grappler database"** to dump. Grappling data is scattered across
semi-structured community sites. This is a *harvest-and-reconcile* problem, which is exactly
what the Phase D pipeline (resolve → review → commit) was built for — that back-end is reused.

## Decomposition — 3 independent pipelines, built in dependency order

1. **Roster + stats** (athletes, records, teams) — the SPINE. Everything hangs off athletes
   existing first. **← we are designing THIS one.**
2. **Match footage** (YouTube) — attaches videos/matches to athletes from #1. YouTube Data API
   (quota-limited, ToS-bound); "find the right match video" is fuzzy title-matching.
3. **Instructionals** (e.g. BJJfanatics) — attaches product links to athletes. Different sources,
   commercial/affiliate flavour.

Each gets its own spec → plan → build cycle. Do NOT try to spec all three at once.

---

## Pipeline #1 — decisions locked so far

- **Primary source: BJJ Heroes** (bjjheroes.com). User chose it over Wikipedia / other sites.
  It's the canonical community DB of pro grapplers.

## Pipeline #1 — technical findings (reverse-engineered 2026-07-05, verified live)

These are the load-bearing facts. All confirmed by live `curl` with a browser User-Agent:

- **Enumeration:** ~**1,511 fighter profiles**, cleanly listed in the WordPress post sitemaps.
  `https://www.bjjheroes.com/sitemap.xml` → `post-sitemap.xml` (709), `post-sitemap2.xml` (424),
  `post-sitemap3.xml` (378) → filter `<loc>` for `/bjj-fighters/`. **This sidesteps the A-Z list
  page entirely** (that list table is a JS/wpDataTables widget — annoying to scrape; ignore it).
- **Profile record data is INLINE in the static HTML** (initial worry that it was AJAX-only was
  wrong — a minified-markup grep artifact fooled the first check; opponent names/methods are right
  there in the page). Each profile has a record table with columns:
  **`ID · Opponent · W/L · Method · Competition · Weight · Stage · Year`**. Uniform across profiles.
- Profile URL pattern: `https://www.bjjheroes.com/bjj-fighters/<slug>` (e.g. `.../gordon-ryan`).
- **robots.txt is permissive:** `User-agent: * / Disallow: /wp-admin/` only. `/bjj-fighters/` and
  sitemaps are allowed. Our fetcher gets HTTP 200. (Note: Anthropic's WebFetch tool infra is
  403-blocked by their host, but direct curl / our own HttpPageFetcher is fine.)

### Architectural implication (important)

Because the data is **already tabular and uniform, this pipeline should NOT use the LLM.**
A small **deterministic parser** (fetch profile → parse the record `<table>` → structured rows)
is cheaper ($0 vs ~1,500 paid calls), faster, and more reliable than Claude extraction.

**Reuse from Phase D:** the back half — entity **resolution** (match "Felipe Pena" to an existing
athlete) and **commit-with-provenance** into our tables. Replace only the front-end: a
`BjjHeroesSource` deterministic parser instead of `ClaudeExtractor`.

**Reframed principle for the whole vision:** the LLM front-end is for *messy prose* sources
(match reports, news articles). Structured sites (BJJ Heroes) get a deterministic parser. Same
resolve/commit back-end, pluggable front-ends per source.

---

## OPEN DECISIONS (resume here)

1. **⛔ gi vs no-gi (BLOCKING — asked, not answered).** RollVault's identity is explicitly no-gi,
   but BJJ Heroes mixes gi + no-gi in each record and doesn't cleanly flag which. You infer format
   from the *competition* (ADCC / WNO / EBI / Polaris / Who's Number One = no-gi; IBJJF Worlds /
   Pans = gi). Options presented:
   - (a) **No-gi only** — build a competition→format classifier, drop/hold gi + unknown. Cleanest
     brand fit; imperfect; discards ~half the data.
   - (b) **Import all, tag gi/no-gi/unknown** — UI filters to no-gi. Most complete + future-proof;
     expands the data model.
   - (c) **Import all, don't distinguish yet** — fastest; risks polluting the "no-gi database".
   → **Undecided. This defines the dataset, so it's the first thing to settle next session.**

2. **Review at scale (not yet raised with user).** Phase D forces human review of every candidate.
   1,500 fighters × dozens of matches ≈ **30k+ rows** — manual review is infeasible. Need a
   different quality gate for bulk, e.g. auto-commit as unpublished drafts with source provenance +
   review ONLY conflicts/merges/low-confidence resolutions. This is a real tension with the current
   review-queue model and must be designed.

3. **One-time backfill vs recurring sync (not yet raised).** Default assumption: one-time bulk
   import first; incremental re-sync later. Confirm.

4. **Licensing / attribution (not yet raised).** BJJ Heroes is community-authored content. Re-
   publishing their records as ours raises an attribution/ToS-good-citizen question. Decide the
   posture (rate-limit politely, attribute source, etc.). robots.txt permits crawling; that's not
   the same as a licence to republish wholesale.

## Next steps when we resume

1. Answer the gi/no-gi question (#1 above).
2. Raise + decide review-at-scale (#2), one-time-vs-recurring (#3), attribution (#4).
3. Propose 2–3 approaches with trade-offs for the roster pipeline.
4. Present design in sections → approval → write the real spec in `docs/superpowers/specs/`.
5. Then writing-plans → implement.
