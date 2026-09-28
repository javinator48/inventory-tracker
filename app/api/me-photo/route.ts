import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, validationError } from "@/lib/api";
import { getMePhoto, imageExists, setMePhoto } from "@/lib/settings";

/** The user's saved photo for try-ons: `{ key }`, with key null when none is set. */
export async function GET() {
  return Response.json({ key: await getMePhoto() });
}

/** `{ key }` of an uploaded photo (from /api/uploads) becomes the saved photo. */
export async function PUT(req: NextRequest) {
  const parsed = z.object({ key: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  if (!(await imageExists(parsed.data.key))) return jsonError("Photo not found", 404);
  await setMePhoto(parsed.data.key);
  return Response.json({ key: parsed.data.key });
}

export async function DELETE() {
  await setMePhoto(null);
  return new Response(null, { status: 204 });
}
