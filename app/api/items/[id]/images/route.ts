import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, parseId, validationError } from "@/lib/api";
import { addImage, getItem, removeImage, setPrimaryImage } from "@/lib/items";
import { downloadImage, isSupportedImageType, MAX_IMAGE_BYTES, saveImage } from "@/lib/storage";

/**
 * Adds an image to an item. Accepts either:
 * - multipart form data with a `file` field (camera or upload), or
 * - JSON `{ url, source? }` to download and keep a copy of a web image.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/images">) {
  const id = parseId((await ctx.params).id);
  if (!id || !(await getItem(id))) return jsonError("Item not found", 404);

  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Missing file");
    if (!isSupportedImageType(file.type)) return jsonError(`Unsupported image type: ${file.type || "unknown"}`);
    if (file.size > MAX_IMAGE_BYTES) return jsonError("Image is larger than 10 MB");
    const key = await saveImage(Buffer.from(await file.arrayBuffer()), file.type);
    const source = form.get("source") === "upload" ? "upload" : "camera";
    return Response.json(await addImage(id, key, source), { status: 201 });
  }

  const parsed = z
    .object({ url: z.url(), source: z.enum(["web", "barcode"]).default("web") })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { data, contentType } = await downloadImage(parsed.data.url);
    const key = await saveImage(data, contentType);
    return Response.json(await addImage(id, key, parsed.data.source), { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Image download failed", 422);
  }
}

/** `{ imageId, primary: true }` makes an image the cover photo. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/items/[id]/images">) {
  const id = parseId((await ctx.params).id);
  const parsed = z.object({ imageId: z.number().int() }).safeParse(await req.json().catch(() => null));
  if (!id || !parsed.success) return jsonError("Invalid request");
  await setPrimaryImage(id, parsed.data.imageId);
  return new Response(null, { status: 204 });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/items/[id]/images">) {
  const id = parseId((await ctx.params).id);
  const imageId = parseId(req.nextUrl.searchParams.get("imageId") ?? "");
  if (!id || !imageId) return jsonError("Invalid request");
  return (await removeImage(id, imageId)) ? new Response(null, { status: 204 }) : jsonError("Image not found", 404);
}
