import type { NextRequest } from "next/server";
import { jsonError, validationError } from "@/lib/api";
import { GeminiNotConfiguredError } from "@/lib/ai/gemini";
import { NoMePhotoError, tryOnInputSchema, tryOnOutfit } from "@/lib/ai/outfits";

export const maxDuration = 180;

/** Renders the saved photo wearing an outfit; returns `{ key }` of the new image. */
export async function POST(req: NextRequest) {
  const parsed = tryOnInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return Response.json({ key: await tryOnOutfit(parsed.data) }, { status: 201 });
  } catch (err) {
    console.error("try-on failed", err);
    const status = err instanceof GeminiNotConfiguredError ? 503 : err instanceof NoMePhotoError ? 409 : 502;
    return jsonError(err instanceof Error ? err.message : "Try-on failed", status);
  }
}
