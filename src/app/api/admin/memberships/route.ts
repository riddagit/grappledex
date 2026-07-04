import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { addMembership } from "@/lib/memberships/service";
import { CreateMembershipSchema } from "./validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreateMembershipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const membership = await addMembership(db, parsed.data);
  return NextResponse.json(membership, { status: 201 });
}
