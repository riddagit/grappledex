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
