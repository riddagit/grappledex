import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createEvent, searchEvents } from "@/lib/events/service";
import { CreateEventSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const event = await createEvent(db, parsed.data);
  return NextResponse.json(event, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchEvents(db, q));
}
