# Phase B.3 — Match / Event / Promotion / Team Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four remaining public entity pages (match, event, promotion, team) — read layer + routes + per-page SEO — so the athlete hub's outbound links resolve.

**Architecture:** One pure read function per page in `src/lib/public/` (mirrors `athlete-page.ts`: async query against `Db`, published-only, returns a typed object or `null`), plus one server-component route per page under `src/app/` reusing the B.2 `globals.css` design system. Grouping/formatting is view-layer; queries stay flat and pglite-testable.

**Tech Stack:** Next.js 15 App Router (server components, `force-dynamic`), Drizzle ORM, Postgres/pglite (tests via `@/db/test-db`), Vitest, React 19.

## Global Constraints

- Public pages render **only `published`** entities; a child whose parent is `draft` must not surface. Missing/draft → read fn returns `null` → route calls `notFound()`.
- **No new source of truth, no new write-path, no new entity.** Read/query + view only.
- Reuse existing services where present: `listVideosForMatch(db, matchId)`, `listVideosForEvent(db, eventId)`.
- Reuse existing design tokens/classes in `src/app/globals.css` (`.wrap`, `.section-head`, `.history`, `.res` + `.w/.l/.d`, `.method.sub`, `.medal`/`.gold`, `.sources`, `.stack`, `.card-list`, `.eyebrow`). Add new CSS only for the match-page video embed (`.embed`).
- Matches are addressed by **id**; event/promotion/team by **slug**.
- Video *embed* = derive the YouTube id from a linked url and render `youtube-nocookie.com/embed/<id>`. No hosting/upload.
- Every route: `export const dynamic = "force-dynamic";` and `generateMetadata`.
- Tests: `npm run test` (Vitest). Build: `npm run build`. Commit after each task.

---

## File Structure

- Create `src/lib/public/promotion-page.ts` + `.test.ts` — `getPromotionPage`.
- Create `src/lib/public/team-page.ts` + `.test.ts` — `getTeamPage`.
- Create `src/lib/public/match-page.ts` + `.test.ts` — `getMatchPage`.
- Create `src/lib/public/event-page.ts` + `.test.ts` — `getEventPage`.
- Create `src/app/promotion/[slug]/page.tsx`, `src/app/team/[slug]/page.tsx`, `src/app/match/[id]/page.tsx`, `src/app/event/[slug]/page.tsx`.
- Modify `src/db/seed.ts` — expose match handles in the return value (Task 1).
- Modify `src/app/globals.css` — add `.embed` block (Task 7).

---

### Task 1: Expose match handles from the seed

The seed already inserts a superfight and a bracket final but only returns
`{ athletes, promotion, event, team }`. Match-page tests need a match id. Add the two
matches to the return value — additive, breaks nothing (existing tests destructure by name).

**Files:**
- Modify: `src/db/seed.ts`

**Interfaces:**
- Produces: `seed(db)` return gains `matches: { superfight: Match; final: Match }`.

- [ ] **Step 1: Capture the bracket final in a variable**

In `src/db/seed.ts`, change the bracket-final insert from `await createMatch(db, {…})` to assign it:

```ts
  // Bracket final: Gordon def. Meregali by submission.
  const final = await createMatch(db, {
    eventId: event.id,
    matchType: "BRACKET",
    round: "Final",
    weightClass: "Absolute",
    ruleset: "ADCC",
    method: "SUBMISSION",
    methodDetail: "Rear Naked Choke",
    durationSeconds: 300,
    competitors: [
      { athleteId: gordon.id, outcome: "WON", slotOrder: 1 },
      { athleteId: meregali.id, outcome: "LOST", slotOrder: 2 },
    ],
    ...pub,
  });
```

- [ ] **Step 2: Add matches to the return**

```ts
  return {
    athletes: { gordon, galvao, meregali },
    promotion: adcc,
    event,
    team,
    matches: { superfight, final },
  };
```

- [ ] **Step 3: Run the existing suite to confirm nothing broke**

Run: `npm run test`
Expected: PASS (all existing tests, incl. `athlete-page.test.ts`, still green).

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts
git commit -m "test: expose seeded match handles for read-layer tests"
```

---

### Task 2: `getPromotionPage` (read layer)

Simplest page — a promotion and its published events. Establishes the file/test shape for
the rest.

**Files:**
- Create: `src/lib/public/promotion-page.ts`
- Test: `src/lib/public/promotion-page.test.ts`

**Interfaces:**
- Consumes: `seed(db)` → `{ promotion, event }`.
- Produces:
  ```ts
  export type PromotionEventRef = {
    name: string; slug: string; startDate: string;
    venue: string | null; location: string | null;
  };
  export type PromotionPage = { promotion: Promotion; events: PromotionEventRef[] };
  export function getPromotionPage(db: Db, slug: string): Promise<PromotionPage | null>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { getPromotionPage } from "@/lib/public/promotion-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getPromotionPage", () => {
  it("returns the promotion with its published events", async () => {
    const s = await seed(ctx.db);
    const page = await getPromotionPage(ctx.db, s.promotion.slug);
    if (!page) throw new Error("expected a page");
    expect(page.promotion.name).toBe("ADCC");
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.name).toBe("ADCC 2022 World Championship");
  });

  it("excludes draft events", async () => {
    const s = await seed(ctx.db);
    await createEvent(ctx.db, {
      promotionId: s.promotion.id, name: "Hidden Event", startDate: "2023-01-01",
    }); // default status draft
    const page = await getPromotionPage(ctx.db, s.promotion.slug);
    expect(page?.events).toHaveLength(1);
  });

  it("returns null for a draft promotion and for an unknown slug", async () => {
    const draft = await createPromotion(ctx.db, { name: "Hidden Promo" });
    expect(await getPromotionPage(ctx.db, draft.slug)).toBeNull();
    expect(await getPromotionPage(ctx.db, "no-such-promo")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm run test -- promotion-page`
Expected: FAIL — cannot find module `promotion-page`.

- [ ] **Step 3: Implement**

```ts
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { promotions, type Promotion } from "@/db/schema/promotion";
import { events } from "@/db/schema/event";

export type PromotionEventRef = {
  name: string; slug: string; startDate: string;
  venue: string | null; location: string | null;
};
export type PromotionPage = { promotion: Promotion; events: PromotionEventRef[] };

export async function getPromotionPage(
  db: Db,
  slug: string,
): Promise<PromotionPage | null> {
  const rows = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.slug, slug), eq(promotions.status, "published")));
  const promotion = rows[0];
  if (!promotion) return null;

  const eventRows = await db
    .select({
      name: events.name, slug: events.slug, startDate: events.startDate,
      venue: events.venue, location: events.location,
    })
    .from(events)
    .where(and(eq(events.promotionId, promotion.id), eq(events.status, "published")))
    .orderBy(desc(events.startDate));

  return { promotion, events: eventRows };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- promotion-page`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/promotion-page.ts src/lib/public/promotion-page.test.ts
git commit -m "feat: add getPromotionPage public read fn"
```

---

### Task 3: `getTeamPage` (read layer)

Team + temporal roster split into current (open membership) and alumni (closed), over
published athletes only.

**Files:**
- Create: `src/lib/public/team-page.ts`
- Test: `src/lib/public/team-page.test.ts`

**Interfaces:**
- Consumes: `seed(db)` → `{ team, athletes }`.
- Produces:
  ```ts
  export type RosterMember = {
    athleteId: string; name: string; slug: string;
    role: string | null; startDate: string; endDate: string | null;
  };
  export type TeamPage = { team: Team; current: RosterMember[]; alumni: RosterMember[] };
  export function getTeamPage(db: Db, slug: string): Promise<TeamPage | null>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createTeam } from "@/lib/teams/service";
import { addMembership } from "@/lib/memberships/service";
import { getTeamPage } from "@/lib/public/team-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getTeamPage", () => {
  it("returns current roster and alumni split by membership end date", async () => {
    const s = await seed(ctx.db); // Gordon is a current New Wave member (no endDate)
    // add a past (alumni) membership for Galvao
    await addMembership(ctx.db, {
      athleteId: s.athletes.galvao.id, teamId: s.team.id, role: "competitor",
      startDate: "2010-01-01", endDate: "2020-12-31", confidence: "CONFIRMED",
    });
    const page = await getTeamPage(ctx.db, s.team.slug);
    if (!page) throw new Error("expected a page");
    expect(page.team.name).toBe("New Wave Jiu-Jitsu");
    expect(page.current.map((m) => m.name)).toEqual(["Gordon Ryan"]);
    expect(page.alumni.map((m) => m.name)).toEqual(["Andre Galvao"]);
  });

  it("returns null for a draft team and unknown slug", async () => {
    const draft = await createTeam(ctx.db, { name: "Hidden Team" });
    expect(await getTeamPage(ctx.db, draft.slug)).toBeNull();
    expect(await getTeamPage(ctx.db, "no-such-team")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm run test -- team-page`
Expected: FAIL — cannot find module `team-page`.

- [ ] **Step 3: Implement**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { teams, type Team } from "@/db/schema/team";
import { athleteTeamMemberships } from "@/db/schema/membership";
import { athletes } from "@/db/schema/athlete";

export type RosterMember = {
  athleteId: string; name: string; slug: string;
  role: string | null; startDate: string; endDate: string | null;
};
export type TeamPage = { team: Team; current: RosterMember[]; alumni: RosterMember[] };

export async function getTeamPage(db: Db, slug: string): Promise<TeamPage | null> {
  const rows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.slug, slug), eq(teams.status, "published")));
  const team = rows[0];
  if (!team) return null;

  const memberRows = await db
    .select({
      athleteId: athletes.id, name: athletes.fullName, slug: athletes.slug,
      role: athleteTeamMemberships.role,
      startDate: athleteTeamMemberships.startDate,
      endDate: athleteTeamMemberships.endDate,
    })
    .from(athleteTeamMemberships)
    .innerJoin(
      athletes,
      and(
        eq(athleteTeamMemberships.athleteId, athletes.id),
        eq(athletes.status, "published"),
      ),
    )
    .where(eq(athleteTeamMemberships.teamId, team.id));

  const current = memberRows
    .filter((m) => m.endDate === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const alumni = memberRows
    .filter((m) => m.endDate !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { team, current, alumni };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- team-page`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/team-page.ts src/lib/public/team-page.test.ts
git commit -m "feat: add getTeamPage public read fn"
```

---

### Task 4: `getMatchPage` (read layer)

Single match by id — competitors ordered by slot, event ref, videos. Published match on a
published event only.

**Files:**
- Create: `src/lib/public/match-page.ts`
- Test: `src/lib/public/match-page.test.ts`

**Interfaces:**
- Consumes: `seed(db)` → `{ matches: { superfight, final }, event }`; `listVideosForMatch`.
- Produces:
  ```ts
  export type MatchCompetitorRef = {
    id: string; name: string; slug: string;
    outcome: "WON" | "LOST" | "DRAW" | "NC" | "DQ"; slotOrder: number | null;
  };
  export type MatchPage = {
    match: Match;
    event: { name: string; slug: string; startDate: string };
    competitors: MatchCompetitorRef[];
    videos: VideoRef[];
  };
  export function getMatchPage(db: Db, id: string): Promise<MatchPage | null>;
  ```
  (`VideoRef` = `{ id: string; url: string; title: string | null }`, defined locally.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createMatch } from "@/lib/matches/service";
import { getMatchPage } from "@/lib/public/match-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getMatchPage", () => {
  it("returns a published match with competitors (slot-ordered), event and videos", async () => {
    const s = await seed(ctx.db);
    const page = await getMatchPage(ctx.db, s.matches.superfight.id);
    if (!page) throw new Error("expected a page");
    expect(page.match.method).toBe("DECISION");
    expect(page.event.slug).toBe(s.event.slug);
    expect(page.competitors.map((c) => c.name)).toEqual(["Gordon Ryan", "Andre Galvao"]);
    expect(page.competitors[0]?.outcome).toBe("WON");
    expect(page.videos).toHaveLength(1);
    expect(page.videos[0]?.url).toContain("youtube.com");
  });

  it("returns null for a draft match", async () => {
    const s = await seed(ctx.db);
    const draft = await createMatch(ctx.db, {
      eventId: s.event.id, matchType: "SUPERFIGHT", method: "POINTS",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.galvao.id, outcome: "LOST" },
      ],
    });
    expect(await getMatchPage(ctx.db, draft.id)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    await seed(ctx.db);
    expect(
      await getMatchPage(ctx.db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm run test -- match-page`
Expected: FAIL — cannot find module `match-page`.

- [ ] **Step 3: Implement**

```ts
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors, type Match } from "@/db/schema/match";
import { events } from "@/db/schema/event";
import { athletes } from "@/db/schema/athlete";
import { listVideosForMatch } from "@/lib/videos/service";

export type VideoRef = { id: string; url: string; title: string | null };

export type MatchCompetitorRef = {
  id: string; name: string; slug: string;
  outcome: "WON" | "LOST" | "DRAW" | "NC" | "DQ"; slotOrder: number | null;
};

export type MatchPage = {
  match: Match;
  event: { name: string; slug: string; startDate: string };
  competitors: MatchCompetitorRef[];
  videos: VideoRef[];
};

export async function getMatchPage(db: Db, id: string): Promise<MatchPage | null> {
  // Match must be published AND on a published event.
  const rows = await db
    .select({
      match: matches,
      eventName: events.name,
      eventSlug: events.slug,
      eventStartDate: events.startDate,
    })
    .from(matches)
    .innerJoin(
      events,
      and(eq(matches.eventId, events.id), eq(events.status, "published")),
    )
    .where(and(eq(matches.id, id), eq(matches.status, "published")));
  const row = rows[0];
  if (!row) return null;

  const competitorRows = await db
    .select({
      id: athletes.id, name: athletes.fullName, slug: athletes.slug,
      outcome: matchCompetitors.outcome, slotOrder: matchCompetitors.slotOrder,
    })
    .from(matchCompetitors)
    .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
    .where(eq(matchCompetitors.matchId, id))
    .orderBy(asc(matchCompetitors.slotOrder));

  const videoRows = await listVideosForMatch(db, id);
  const videos: VideoRef[] = videoRows.map((v) => ({
    id: v.id, url: v.url, title: v.title,
  }));

  return {
    match: row.match,
    event: { name: row.eventName, slug: row.eventSlug, startDate: row.eventStartDate },
    competitors: competitorRows as MatchCompetitorRef[],
    videos,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- match-page`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/match-page.ts src/lib/public/match-page.test.ts
git commit -m "feat: add getMatchPage public read fn"
```

---

### Task 5: `getEventPage` (read layer)

Event + promotion ref + flat `results[]` (published matches with competitors, method, videos)
+ placements. The route groups results; the query stays flat.

**Files:**
- Create: `src/lib/public/event-page.ts`
- Test: `src/lib/public/event-page.test.ts`

**Interfaces:**
- Consumes: `seed(db)` → `{ event, promotion }`; `listVideosForEvent`.
- Produces:
  ```ts
  export type EventResult = {
    matchId: string; matchType: string; round: string | null;
    weightClass: string | null; method: string; methodDetail: string | null;
    competitors: { id: string; name: string; slug: string; outcome: string }[];
    videos: VideoRef[];
  };
  export type EventPlacement = {
    division: string; place: number; athlete: { name: string; slug: string };
  };
  export type EventPage = {
    event: Event;
    promotion: { name: string; slug: string };
    results: EventResult[];
    placements: EventPlacement[];
  };
  export function getEventPage(db: Db, slug: string): Promise<EventPage | null>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { getEventPage } from "@/lib/public/event-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getEventPage", () => {
  it("returns the event, promotion, published results and placements", async () => {
    const s = await seed(ctx.db);
    const page = await getEventPage(ctx.db, s.event.slug);
    if (!page) throw new Error("expected a page");
    expect(page.promotion.name).toBe("ADCC");
    expect(page.results).toHaveLength(2); // superfight + bracket final
    const sub = page.results.find((r) => r.method === "SUBMISSION");
    expect(sub?.round).toBe("Final");
    expect(sub?.competitors.map((c) => c.name)).toContain("Nicholas Meregali");
    const sf = page.results.find((r) => r.matchType === "SUPERFIGHT");
    expect(sf?.videos).toHaveLength(1);
    expect(page.placements).toHaveLength(2);
    expect(page.placements.find((p) => p.place === 1)?.athlete.name).toBe("Gordon Ryan");
  });

  it("excludes draft matches from results", async () => {
    const s = await seed(ctx.db);
    await createMatch(ctx.db, {
      eventId: s.event.id, matchType: "SUPERFIGHT", method: "POINTS",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.meregali.id, outcome: "LOST" },
      ],
    }); // draft
    const page = await getEventPage(ctx.db, s.event.slug);
    expect(page?.results).toHaveLength(2);
  });

  it("returns null for a draft event and unknown slug", async () => {
    const s = await seed(ctx.db);
    const draft = await createEvent(ctx.db, {
      promotionId: s.promotion.id, name: "Hidden", startDate: "2024-01-01",
    });
    expect(await getEventPage(ctx.db, draft.slug)).toBeNull();
    expect(await getEventPage(ctx.db, "no-such-event")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm run test -- event-page`
Expected: FAIL — cannot find module `event-page`.

- [ ] **Step 3: Implement**

```ts
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, type Event } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { matches, matchCompetitors } from "@/db/schema/match";
import { athletes } from "@/db/schema/athlete";
import { placements } from "@/db/schema/placement";
import { listVideosForEvent } from "@/lib/videos/service";

export type VideoRef = { id: string; url: string; title: string | null };

export type EventResult = {
  matchId: string; matchType: string; round: string | null;
  weightClass: string | null; method: string; methodDetail: string | null;
  competitors: { id: string; name: string; slug: string; outcome: string }[];
  videos: VideoRef[];
};
export type EventPlacement = {
  division: string; place: number; athlete: { name: string; slug: string };
};
export type EventPage = {
  event: Event;
  promotion: { name: string; slug: string };
  results: EventResult[];
  placements: EventPlacement[];
};

export async function getEventPage(db: Db, slug: string): Promise<EventPage | null> {
  const rows = await db
    .select({ event: events, promoName: promotions.name, promoSlug: promotions.slug })
    .from(events)
    .innerJoin(promotions, eq(events.promotionId, promotions.id))
    .where(and(eq(events.slug, slug), eq(events.status, "published")));
  const row = rows[0];
  if (!row) return null;
  const event = row.event;

  const matchRows = await db
    .select({
      id: matches.id, matchType: matches.matchType, round: matches.round,
      weightClass: matches.weightClass, method: matches.method,
      methodDetail: matches.methodDetail,
    })
    .from(matches)
    .where(and(eq(matches.eventId, event.id), eq(matches.status, "published")));
  const matchIds = matchRows.map((m) => m.id);

  const competitorRows = matchIds.length
    ? await db
        .select({
          matchId: matchCompetitors.matchId,
          id: athletes.id, name: athletes.fullName, slug: athletes.slug,
          outcome: matchCompetitors.outcome, slotOrder: matchCompetitors.slotOrder,
        })
        .from(matchCompetitors)
        .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
        .where(inArray(matchCompetitors.matchId, matchIds))
    : [];
  const compsByMatch = new Map<string, EventResult["competitors"]>();
  for (const c of [...competitorRows].sort(
    (a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0),
  )) {
    const list = compsByMatch.get(c.matchId) ?? [];
    list.push({ id: c.id, name: c.name, slug: c.slug, outcome: c.outcome });
    compsByMatch.set(c.matchId, list);
  }

  const eventVideos = await listVideosForEvent(db, event.id);
  const videosByMatch = new Map<string, VideoRef[]>();
  for (const v of eventVideos) {
    if (!v.matchId) continue;
    const list = videosByMatch.get(v.matchId) ?? [];
    list.push({ id: v.id, url: v.url, title: v.title });
    videosByMatch.set(v.matchId, list);
  }

  const results: EventResult[] = matchRows.map((m) => ({
    matchId: m.id, matchType: m.matchType, round: m.round,
    weightClass: m.weightClass, method: m.method, methodDetail: m.methodDetail,
    competitors: compsByMatch.get(m.id) ?? [],
    videos: videosByMatch.get(m.id) ?? [],
  }));

  const placementRows = await db
    .select({
      division: placements.division, place: placements.place,
      name: athletes.fullName, slug: athletes.slug,
    })
    .from(placements)
    .innerJoin(athletes, eq(placements.athleteId, athletes.id))
    .where(eq(placements.eventId, event.id));
  const placementList: EventPlacement[] = placementRows
    .map((p) => ({ division: p.division, place: p.place, athlete: { name: p.name, slug: p.slug } }))
    .sort((a, b) => a.place - b.place);

  return {
    event,
    promotion: { name: row.promoName, slug: row.promoSlug },
    results,
    placements: placementList,
  };
}
```

Note: `listVideosForEvent` returns video rows including `matchId`; verify its select
includes `matchId` (it does — videos reference matches). If a returned row lacks `matchId`
it is skipped (guard above).

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- event-page`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/event-page.ts src/lib/public/event-page.test.ts
git commit -m "feat: add getEventPage public read fn"
```

---

### Task 6: `/promotion/[slug]` route

**Files:**
- Create: `src/app/promotion/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getPromotionPage`, `PromotionPage`.

- [ ] **Step 1: Implement the route**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getPromotionPage, type PromotionPage } from "@/lib/public/promotion-page";

export const dynamic = "force-dynamic";

function year(date: string): string { return date.slice(0, 4); }

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPromotionPage(db, slug);
  if (!page) return { title: "Not found — Grappledex" };
  const title = `${page.promotion.name} — events & results — Grappledex`;
  const description = `${page.promotion.name} grappling events, cards and results.`;
  return { title, description, openGraph: { title, description } };
}

export default async function PromotionPublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getPromotionPage(db, slug);
  if (!page) notFound();
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow"><span>Promotion</span></div>
        <h1 className="athlete-name">{page.promotion.name}</h1>
      </header>
      <Events page={page} />
    </main>
  );
}

function Events({ page }: { page: PromotionPage }) {
  return (
    <section>
      <div className="section-head">Events</div>
      {page.events.length === 0 ? (
        <p className="empty">No events recorded yet.</p>
      ) : (
        <div className="stack">
          {page.events.map((e) => (
            <div key={e.slug}>
              <Link href={`/event/${e.slug}`}>{e.name}</Link>
              {" · "}<span className="now">{year(e.startDate)}</span>
              {e.location ? ` · ${e.location}` : ""}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck via build (no local DB needed for compile)**

Run: `npm run build`
Expected: compiles; the page type-checks. (Runtime data fetch needs `DATABASE_URL`; not required to pass the build's type/lint stage. If the build attempts static collection and errors only on DB connection, that is the known env limitation — the compile/type/lint must still be clean.)

- [ ] **Step 3: Commit**

```bash
git add src/app/promotion/[slug]/page.tsx
git commit -m "feat: add public /promotion/[slug] page"
```

---

### Task 7: `/team/[slug]` route

**Files:**
- Create: `src/app/team/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getTeamPage`, `TeamPage`, `RosterMember`.

- [ ] **Step 1: Implement the route**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getTeamPage, type RosterMember } from "@/lib/public/team-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getTeamPage(db, slug);
  if (!page) return { title: "Not found — Grappledex" };
  const title = `${page.team.name} — roster & alumni — Grappledex`;
  const description = `${page.team.name} grappling team: current roster and notable alumni.`;
  return { title, description, openGraph: { title, description } };
}

export default async function TeamPublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getTeamPage(db, slug);
  if (!page) notFound();
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow"><span>Team</span></div>
        <h1 className="athlete-name">{page.team.name}</h1>
      </header>
      <Roster title="Current roster" members={page.current} />
      <Roster title="Alumni" members={page.alumni} />
    </main>
  );
}

function Roster({ title, members }: { title: string; members: RosterMember[] }) {
  if (members.length === 0) return null;
  return (
    <section>
      <div className="section-head">{title}</div>
      <div className="stack">
        {members.map((m) => (
          <div key={m.athleteId}>
            <Link href={`/athlete/${m.slug}`}>{m.name}</Link>
            {m.role ? ` · ${m.role}` : ""}
            {" · "}
            <span className={m.endDate === null ? "now" : ""}>
              {m.startDate}–{m.endDate ?? "present"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: type/lint clean (same env caveat as Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/app/team/[slug]/page.tsx
git commit -m "feat: add public /team/[slug] page"
```

---

### Task 8: `/match/[id]` route + video embed

The one page dedicated to a single match; method is the focal fact; first video embedded.

**Files:**
- Create: `src/app/match/[id]/page.tsx`
- Modify: `src/app/globals.css` (add `.embed` block)

**Interfaces:**
- Consumes: `getMatchPage`, `MatchPage`.

- [ ] **Step 1: Add the embed CSS**

Append to `src/app/globals.css`:

```css
/* Match-page video embed — responsive 16:9 */
.embed {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 1rem 0;
  border: 1px solid var(--line);
  background: #000;
}
.embed iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
```

(If `--line` is not a defined token, use the existing border token in `globals.css` — check the athlete table border variable and match it.)

- [ ] **Step 2: Implement the route**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getMatchPage, type MatchPage } from "@/lib/public/match-page";

export const dynamic = "force-dynamic";

function year(date: string): string { return date.slice(0, 4); }

function methodLabel(method: string, detail: string | null): string {
  if (method === "SUBMISSION") return detail ?? "Submission";
  if (method === "DECISION") return "Decision";
  if (method === "POINTS") return "Points";
  if (method === "OVERTIME") return "Overtime";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

function duration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// Extract a YouTube video id from a watch/share/embed url; null if not YouTube.
export function youtubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const page = await getMatchPage(db, id);
  if (!page) return { title: "Not found — Grappledex" };
  const names = page.competitors.map((c) => c.name).join(" vs ");
  const title = `${names} — ${page.event.name} — Grappledex`;
  const description = `${names} at ${page.event.name} (${year(page.event.startDate)}): ${methodLabel(page.match.method, page.match.methodDetail)}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function MatchPublicPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const page = await getMatchPage(db, id);
  if (!page) notFound();
  const embedId = page.videos.length ? youtubeId(page.videos[0]!.url) : null;
  const facts = [
    page.match.weightClass,
    page.match.ruleset,
    page.match.round,
    duration(page.match.durationSeconds),
  ].filter(Boolean);
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow">
          <Link href={`/event/${page.event.slug}`}>{page.event.name}</Link>
          <span>·</span>
          <span>{year(page.event.startDate)}</span>
        </div>
        <h1 className="athlete-name">
          {page.competitors.map((c, i) => (
            <span key={c.id} className={c.outcome === "WON" ? "" : "loss"}>
              {i > 0 ? " vs " : ""}
              <Link href={`/athlete/${c.slug}`}>{c.name}</Link>
            </span>
          ))}
        </h1>
      </header>

      <section>
        <div className="section-head">Result</div>
        <p className={`method ${page.match.method === "SUBMISSION" ? "sub" : ""}`}>
          {methodLabel(page.match.method, page.match.methodDetail)}
        </p>
        {facts.length > 0 && <p className="empty">{facts.join(" · ")}</p>}
      </section>

      {embedId ? (
        <section>
          <div className="section-head">Watch</div>
          <div className="embed">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${embedId}`}
              title="Match video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {page.videos.slice(1).map((v, i) => (
            <a key={v.id} className="card" href={v.url} target="_blank" rel="noreferrer">
              <span className="t">{v.title ?? `Additional angle ${i + 2}`}</span>
              <span className="s">YouTube ↗</span>
            </a>
          ))}
        </section>
      ) : page.videos.length ? (
        <section>
          <div className="section-head">Watch</div>
          <div className="card-list">
            {page.videos.map((v) => (
              <a key={v.id} className="card" href={v.url} target="_blank" rel="noreferrer">
                <span className="t">{v.title ?? "Match video"}</span>
                <span className="s">YouTube ↗</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <Sources page={page} />
    </main>
  );
}

function Sources({ page }: { page: MatchPage }) {
  const verifiedAt = page.match.verifiedAt;
  return (
    <div className="sources">
      Sources · {verifiedAt ? `last verified ${new Date(verifiedAt).toISOString().slice(0, 10)}` : "verification pending"}
    </div>
  );
}
```

- [ ] **Step 3: Add a unit test for `youtubeId` (pure helper, worth locking)**

Create `src/app/match/[id]/youtube-id.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { youtubeId } from "./page";

describe("youtubeId", () => {
  it("parses watch, short and embed urls", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=abc123XYZ_-")).toBe("abc123XYZ_-");
    expect(youtubeId("https://youtu.be/abc123XYZ_-")).toBe("abc123XYZ_-");
    expect(youtubeId("https://www.youtube-nocookie.com/embed/abc123XYZ_-")).toBe("abc123XYZ_-");
  });
  it("returns null for non-youtube urls", () => {
    expect(youtubeId("https://example.com/video")).toBeNull();
  });
});
```

- [ ] **Step 4: Run the helper test + build**

Run: `npm run test -- youtube-id`
Expected: PASS (2 tests).
Run: `npm run build`
Expected: type/lint clean (env caveat as before).

- [ ] **Step 5: Commit**

```bash
git add src/app/match/[id]/page.tsx src/app/match/[id]/youtube-id.test.ts src/app/globals.css
git commit -m "feat: add public /match/[id] page with embedded video"
```

---

### Task 9: `/event/[slug]` route + grouped results + SportsEvent JSON-LD

**Files:**
- Create: `src/app/event/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getEventPage`, `EventPage`, `EventResult`.

- [ ] **Step 1: Implement the route**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getEventPage, type EventPage, type EventResult } from "@/lib/public/event-page";

export const dynamic = "force-dynamic";

function year(date: string): string { return date.slice(0, 4); }

function methodLabel(method: string, detail: string | null): string {
  if (method === "SUBMISSION") return detail ?? "Submission";
  if (method === "DECISION") return "Decision";
  if (method === "POINTS") return "Points";
  if (method === "OVERTIME") return "Overtime";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

const ROUND_ORDER = ["Final", "Semifinal", "Quarterfinal", "Round of 16", "Round of 32"];
function roundRank(round: string | null): number {
  const i = ROUND_ORDER.indexOf(round ?? "");
  return i === -1 ? ROUND_ORDER.length : i;
}

// Group results: superfights first, then bracket matches by round (Final → …).
type ResultGroup = { label: string; rows: EventResult[] };
function groupResults(results: EventResult[]): ResultGroup[] {
  const superfights = results.filter((r) => r.matchType !== "BRACKET");
  const bracket = results.filter((r) => r.matchType === "BRACKET");
  const groups: ResultGroup[] = [];
  if (superfights.length) groups.push({ label: "Superfights", rows: superfights });
  const byRound = new Map<string, EventResult[]>();
  for (const r of bracket) {
    const key = r.round ?? "Bracket";
    (byRound.get(key) ?? byRound.set(key, []).get(key)!).push(r);
  }
  [...byRound.entries()]
    .sort((a, b) => roundRank(a[0]) - roundRank(b[0]))
    .forEach(([label, rows]) => groups.push({ label, rows }));
  return groups;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getEventPage(db, slug);
  if (!page) return { title: "Not found — Grappledex" };
  const title = `${page.event.name} — results — Grappledex`;
  const description = `${page.event.name} (${page.promotion.name}, ${year(page.event.startDate)}): full results and match videos.`;
  return { title, description, openGraph: { title, description } };
}

export default async function EventPublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getEventPage(db, slug);
  if (!page) notFound();
  const groups = groupResults(page.results);
  return (
    <main className="wrap">
      <SportsEventJsonLd page={page} />
      <header>
        <div className="eyebrow">
          <Link href={`/promotion/${page.promotion.slug}`}>{page.promotion.name}</Link>
          <span>·</span>
          <span>{page.event.startDate}{page.event.endDate ? `–${page.event.endDate}` : ""}</span>
        </div>
        <h1 className="athlete-name">{page.event.name}</h1>
        {(page.event.venue || page.event.location) && (
          <p className="empty">
            {[page.event.venue, page.event.location].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      {groups.length === 0 ? (
        <p className="empty">No results recorded yet.</p>
      ) : (
        groups.map((g) => <ResultTable key={g.label} group={g} />)
      )}

      <Medals page={page} />
    </main>
  );
}

function ResultTable({ group }: { group: ResultGroup }) {
  return (
    <section>
      <div className="section-head">{group.label}</div>
      <div className="table-scroll">
        <table className="history">
          <thead>
            <tr><th>Winner</th><th>Opponent</th><th>Method</th></tr>
          </thead>
          <tbody>
            {group.rows.map((r) => {
              const winner = r.competitors.find((c) => c.outcome === "WON");
              const others = r.competitors.filter((c) => c !== winner);
              return (
                <tr key={r.matchId}>
                  <td className="opp">
                    {winner ? (
                      <Link href={`/match/${r.matchId}`}>{winner.name}</Link>
                    ) : (
                      <Link href={`/match/${r.matchId}`}>—</Link>
                    )}
                  </td>
                  <td className="opp">
                    {others.map((o, i) => (
                      <span key={o.id}>
                        {i > 0 ? ", " : ""}
                        <Link href={`/athlete/${o.slug}`}>{o.name}</Link>
                      </span>
                    ))}
                  </td>
                  <td className={`method ${r.method === "SUBMISSION" ? "sub" : ""}`}>
                    {methodLabel(r.method, r.methodDetail)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Medals({ page }: { page: EventPage }) {
  if (page.placements.length === 0) return null;
  const ordinal = ["", "1st", "2nd", "3rd"];
  return (
    <section>
      <div className="section-head">Placements</div>
      <div className="medals">
        {page.placements.map((p, i) => (
          <div className={`medal ${p.place === 1 ? "gold" : ""}`} key={`${p.division}-${p.athlete.slug}-${i}`}>
            <span className="place">{ordinal[p.place] ?? `${p.place}th`}</span>
            <span>
              {p.division} · <Link href={`/athlete/${p.athlete.slug}`}>{p.athlete.name}</Link>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SportsEventJsonLd({ page }: { page: EventPage }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: page.event.name,
    startDate: page.event.startDate,
    endDate: page.event.endDate ?? undefined,
    location: page.event.location
      ? { "@type": "Place", name: page.event.venue ?? page.event.location, address: page.event.location }
      : undefined,
    organizer: { "@type": "Organization", name: page.promotion.name },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: type/lint clean (env caveat).

- [ ] **Step 3: Commit**

```bash
git add src/app/event/[slug]/page.tsx
git commit -m "feat: add public /event/[slug] page with grouped results + SportsEvent JSON-LD"
```

---

### Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm run test`
Expected: PASS — all prior tests plus the four read-layer suites and the `youtubeId` test.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: compiles, type-checks, lints clean. (Runtime static-collection DB errors are the
known no-local-Postgres limitation, per spec §6 — the type/lint stage must be clean and no
route may fail to compile.)

- [ ] **Step 3: Confirm the athlete page's outbound links now resolve**

Manually confirm each `Link` target in `src/app/athlete/[slug]/page.tsx`
(`/event/[slug]`, `/team/[slug]`) plus the new `/match/[id]` and `/promotion/[slug]` routes
exist under `src/app/`. No dead links remain.

- [ ] **Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: Phase B.3 verification pass" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §3.1 `getMatchPage` → Task 4. §3.2 `getEventPage` → Task 5. §3.3 `getPromotionPage` →
  Task 2. §3.4 `getTeamPage` → Task 3. ✓
- §4.1 match route + embed → Task 8. §4.2 event route + grouping → Task 9. §4.3 promotion →
  Task 6. §4.4 team → Task 7. ✓
- §5 per-page SEO (metadata on all four; `SportsEvent` on event) → Tasks 6–9. ✓
- §5 sitemap/robots → correctly deferred to B.4 (out of scope here). ✓
- §6 testing (one suite per read fn, published-only + draft-parent exclusion, minimal seed
  extension) → Tasks 1–5. ✓

**Placeholder scan:** No TBD/TODO. Two "verify the existing token" notes (Task 5 on
`listVideosForEvent.matchId`; Task 8 on the `--line`/border token) are explicit checks with
a concrete fallback, not open placeholders.

**Type consistency:** `VideoRef` shape (`{id,url,title}`) identical in match-page and
event-page. `getEventPage` returns flat `results[]` with `matchType`/`round`; the event
route's `groupResults` consumes exactly those fields. `RosterMember`, `MatchCompetitorRef`,
`EventResult` names used consistently between their defining read fn and consuming route.
Route param shape is `Promise<{…}>` (Next 15) matching the athlete page. ✓
