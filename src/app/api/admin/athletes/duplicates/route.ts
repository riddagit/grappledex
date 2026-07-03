import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { findAthleteDuplicates } from "@/lib/athletes/service";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!name) return NextResponse.json([]);
  return NextResponse.json(await findAthleteDuplicates(db, name));
}
