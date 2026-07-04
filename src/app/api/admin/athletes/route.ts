import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createAthlete, searchAthletes } from "@/lib/athletes/service";
import { CreateAthleteSchema } from "./validation";

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
