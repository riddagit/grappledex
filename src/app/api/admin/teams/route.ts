import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createTeam, searchTeams } from "@/lib/teams/service";
import { CreateTeamSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const team = await createTeam(db, parsed.data);
  return NextResponse.json(team, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchTeams(db, q));
}
