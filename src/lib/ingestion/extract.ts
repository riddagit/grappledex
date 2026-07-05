import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ExtractionSchema, type CandidateGraph } from "@/lib/ingestion/schema";

export interface Extractor {
  extract(text: string): Promise<CandidateGraph>;
}

/** Test double: returns a preset graph, ignoring the input text. */
export class FakeExtractor implements Extractor {
  constructor(private readonly graph: CandidateGraph) {}
  async extract(): Promise<CandidateGraph> {
    return this.graph;
  }
}

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

/**
 * Real extractor. Uses structured outputs so the model returns schema-valid JSON.
 * Reads ANTHROPIC_API_KEY from the environment (see .env.local). Model id from
 * INGEST_MODEL, default claude-opus-4-8.
 */
export class ClaudeExtractor implements Extractor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
    this.model = process.env.INGEST_MODEL ?? "claude-opus-4-8";
  }

  async extract(text: string): Promise<CandidateGraph> {
    // z.toJSONSchema (Zod v4) yields a JSON Schema with additionalProperties:false,
    // which structured outputs requires.
    const schema = z.toJSONSchema(ExtractionSchema);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: EXTRACTION_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: text }],
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("ClaudeExtractor: no text block in response");
    }
    return ExtractionSchema.parse(JSON.parse(block.text));
  }
}
