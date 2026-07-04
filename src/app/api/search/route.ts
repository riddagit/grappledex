import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { search } from "@/lib/public/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await search(db, q);
  return NextResponse.json(results);
}
