import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { commitBatch } from "@/lib/ingestion/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const counts = await commitBatch(db, id);
    return NextResponse.json(counts);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "commit failed" },
      { status: 409 },
    );
  }
}
