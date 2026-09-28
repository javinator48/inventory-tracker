import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, validationError } from "@/lib/api";
import { describeAiError } from "@/lib/ai/client";
import { newPieceSchema, suggestOutfits } from "@/lib/ai/outfits";

export const maxDuration = 180;

/** `{ pieces: [{ imageKey?, name? }] }` → `{ suggestion, items }`: outfits pairing new pieces with owned ones. */
export async function POST(req: NextRequest) {
  const parsed = z
    .object({ pieces: z.array(newPieceSchema).min(1).max(4) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return Response.json(await suggestOutfits(parsed.data.pieces));
  } catch (err) {
    console.error("outfit suggestions failed", err);
    const { message, status } = describeAiError(err);
    return jsonError(message, status);
  }
}
