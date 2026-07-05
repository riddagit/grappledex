/**
 * Live smoke test for ClaudeExtractor — the one ingestion path that unit tests
 * cannot exercise (they stub the Extractor). Makes a real, billed Anthropic API
 * call, so it is NOT part of the CI test suite.
 *
 * Run:  npm run ingest:smoke
 * Needs ANTHROPIC_API_KEY in .env.local (optionally INGEST_MODEL to override the
 * default claude-opus-4-8). Pass your own article text as the first CLI arg, or
 * it uses the built-in sample below.
 */
import { ClaudeExtractor } from "@/lib/ingestion/extract";

const SAMPLE = `At ADCC 2022 in Las Vegas on September 17, 2022, Gordon Ryan defeated
Andre Galvao by decision in the superfight. In the +99kg division, Gordon Ryan
took first place and Nicholas Meregali finished second.`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local, then re-run `npm run ingest:smoke`.",
    );
    process.exit(1);
  }

  const text = process.argv[2] ?? SAMPLE;
  const model = process.env.INGEST_MODEL ?? "claude-opus-4-8";
  console.error(`Extracting with ${model}…\n`);

  const graph = await new ClaudeExtractor().extract(text);

  console.log(JSON.stringify(graph, null, 2));
  console.error(
    `\nOK — ${graph.athletes.length} athletes, ${graph.promotions.length} promotions, ` +
      `${graph.events.length} events, ${graph.matches.length} matches, ${graph.placements.length} placements.`,
  );
}

main().catch((err) => {
  console.error("\nExtraction failed:");
  console.error(err);
  process.exit(1);
});
