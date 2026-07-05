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
    // Batch is marked failed inside runExtraction; return it so the UI can show the error.
    return NextResponse.json(await getBatch(db, batch.id), { status: 502 });
  }
  return NextResponse.json(await getBatch(db, batch.id), { status: 201 });
}
