import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  FakeExtractor,
  ClaudeExtractor,
  EXTRACTION_SYSTEM_PROMPT,
  type Extractor,
} from "@/lib/ingestion/extract";
import { ExtractionSchema, type CandidateGraph } from "@/lib/ingestion/schema";

const graph: CandidateGraph = {
  athletes: [{ localRef: "a1", fullName: "Gordon Ryan" }],
  promotions: [{ localRef: "p1", name: "ADCC" }],
  events: [{ localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" }],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [{ athleteRef: "a1", outcome: "WON" }],
  }],
  placements: [],
};

describe("FakeExtractor", () => {
  it("returns the preset graph and satisfies the Extractor interface", async () => {
    const extractor: Extractor = new FakeExtractor(graph);
    const out = await extractor.extract("ignored text");
    expect(ExtractionSchema.parse(out)).toEqual(graph);
  });
});

describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("instructs the model to emit placements", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/placement/i);
  });
});

/** Build a mock Anthropic client whose messages.parse resolves to `response`. */
function mockClient(response: unknown): { client: Anthropic; parse: ReturnType<typeof vi.fn> } {
  const parse = vi.fn().mockResolvedValue(response);
  const client = { messages: { parse } } as unknown as Anthropic;
  return { client, parse };
}

describe("ClaudeExtractor", () => {
  it("calls messages.parse with adaptive thinking and a structured-output format, and returns parsed_output", async () => {
    const { client, parse } = mockClient({ parsed_output: graph, stop_reason: "end_turn" });
    const extractor = new ClaudeExtractor(client);

    const out = await extractor.extract("some article text");

    expect(out).toEqual(graph);
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: { type: "adaptive" },
        system: EXTRACTION_SYSTEM_PROMPT,
        output_config: expect.objectContaining({ format: expect.anything() }),
        messages: [{ role: "user", content: "some article text" }],
      }),
    );
  });

  it("throws when the model returns no parsed output (e.g. a refusal)", async () => {
    const { client } = mockClient({ parsed_output: null, stop_reason: "refusal" });
    const extractor = new ClaudeExtractor(client);

    await expect(extractor.extract("x")).rejects.toThrow(/no parsed output.*refusal/i);
  });
});

describe("ExtractionSchema structured-output format", () => {
  it("builds a zodOutputFormat without throwing on the schema's min/int/positive constraints", () => {
    // The old hand-rolled path emitted minLength/minimum, which structured
    // outputs rejects; zodOutputFormat strips them. Guard that it stays buildable.
    expect(() => zodOutputFormat(ExtractionSchema)).not.toThrow();
  });
});
