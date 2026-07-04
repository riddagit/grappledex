import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { addPlacement } from "@/lib/placements/service";
import { AddPlacementSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = AddPlacementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const placement = await addPlacement(db, parsed.data);
  return NextResponse.json(placement, { status: 201 });
}
