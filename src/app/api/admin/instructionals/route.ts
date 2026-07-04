import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  addInstructional, listInstructionalsForAthlete, listInstructionals,
} from "@/lib/instructionals/service";
import { AddInstructionalSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = AddInstructionalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const instructional = await addInstructional(db, parsed.data);
  return NextResponse.json(instructional, { status: 201 });
}

export async function GET(request: Request) {
  const athleteId = new URL(request.url).searchParams.get("athleteId");
  if (athleteId) {
    return NextResponse.json(await listInstructionalsForAthlete(db, athleteId));
  }
  return NextResponse.json(await listInstructionals(db));
}
