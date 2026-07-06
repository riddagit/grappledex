import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { publishAllPublishable, publishAthleteGraph } from "@/lib/curation/publish";
import { PublishRequestSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = PublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = parsed.data.scope === "all"
      ? await publishAllPublishable(db)
      : await publishAthleteGraph(db, parsed.data.athleteId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
