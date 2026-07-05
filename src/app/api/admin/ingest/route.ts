import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createBatch, runExtraction, getBatch } from "@/lib/ingestion/service";
import { ClaudeExtractor } from "@/lib/ingestion/extract";
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
  const batch = await createBatch(db, parsed.data);
  try {
    await runExtraction(db, new ClaudeExtractor(), batch.id);
  } catch {
    // Batch is marked failed inside runExtraction; return it so the UI can show the error.
    return NextResponse.json(await getBatch(db, batch.id), { status: 502 });
  }
  return NextResponse.json(await getBatch(db, batch.id), { status: 201 });
}
