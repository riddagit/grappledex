import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createAthlete, searchAthletes } from "@/lib/athletes/service";

export const CreateAthleteSchema = z.object({
  fullName: z.string().min(1),
  nationality: z.string().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateAthleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const athlete = await createAthlete(db, parsed.data);
  return NextResponse.json(athlete, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchAthletes(db, q));
}
