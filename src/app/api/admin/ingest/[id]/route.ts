import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { getBatch, setDecision } from "@/lib/ingestion/service";
import { DecisionSchema } from "../validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await getBatch(db, id);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(loaded);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // batch id is implied by the candidate id
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await setDecision(db, parsed.data.candidateId, parsed.data.decision);
  return NextResponse.json({ ok: true });
}
