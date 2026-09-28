import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, validationError } from "@/lib/api";
import { checkPurchase, purchaseCandidateSchema } from "@/lib/ai/buy-check";
import { describeAiError } from "@/lib/ai/client";

export const maxDuration = 180;

/** `{ product }` → `{ check, items }`: a KonMari-style verdict plus the owned items it refers to. */
export async function POST(req: NextRequest) {
  const parsed = z.object({ product: purchaseCandidateSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return Response.json(await checkPurchase(parsed.data.product));
  } catch (err) {
    console.error("buy check failed", err);
    const { message, status } = describeAiError(err);
    return jsonError(message, status);
  }
}
