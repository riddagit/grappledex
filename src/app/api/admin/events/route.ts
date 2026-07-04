import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createEvent, searchEvents } from "@/lib/events/service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CreateEventSchema = z.object({
  promotionId: z.string().uuid(),
  name: z.string().min(1),
  startDate: z.string().regex(ISO_DATE, "expected YYYY-MM-DD"),
  endDate: z.string().regex(ISO_DATE).optional(),
  venue: z.string().optional(),
  location: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

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
