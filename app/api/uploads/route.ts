import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/api";
import { isSupportedImageType, MAX_IMAGE_BYTES, saveImage } from "@/lib/storage";

/** Stores a photo that isn't attached to an item yet (outfit pieces, chat attachments). Returns `{ key }`. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("Missing file");
  if (!isSupportedImageType(file.type)) return jsonError(`Unsupported image type: ${file.type || "unknown"}`);
  if (file.size > MAX_IMAGE_BYTES) return jsonError("Image is larger than 10 MB");
  return Response.json({ key: await saveImage(Buffer.from(await file.arrayBuffer()), file.type) }, { status: 201 });
}
