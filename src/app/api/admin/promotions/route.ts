import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { createPromotion, searchPromotions } from "@/lib/promotions/service";

export const CreatePromotionSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = CreatePromotionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const promotion = await createPromotion(db, parsed.data);
  return NextResponse.json(promotion, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchPromotions(db, q));
}
