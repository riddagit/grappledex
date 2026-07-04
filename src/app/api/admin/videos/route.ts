import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { addVideo, listVideosForMatch } from "@/lib/videos/service";
import { AddVideoSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = AddVideoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const video = await addVideo(db, parsed.data);
  return NextResponse.json(video, { status: 201 });
}

export async function GET(request: Request) {
  const matchId = new URL(request.url).searchParams.get("matchId");
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }
  return NextResponse.json(await listVideosForMatch(db, matchId));
}
