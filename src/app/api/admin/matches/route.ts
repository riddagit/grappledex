import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createMatch } from "@/lib/matches/service";
import { CreateMatchSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateMatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const match = await createMatch(db, parsed.data);
  return NextResponse.json(match, { status: 201 });
}
