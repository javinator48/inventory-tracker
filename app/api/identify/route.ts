import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/api";
import { describeAiError } from "@/lib/ai/client";
import { identifyProduct, type IdentifyInput } from "@/lib/ai/identify";

export const maxDuration = 180;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * Identifies a product with Claude + web search. Accepts either:
 * - multipart form data with an `image` file (and optional `hint`), or
 * - JSON `{ query }` to look a product up by name.
 */
export async function POST(req: NextRequest) {
  let input: IdentifyInput;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const image = form.get("image");
    if (!(image instanceof File)) return jsonError("Missing image");
    if (!IMAGE_TYPES.includes(image.type as ImageType)) return jsonError(`Unsupported image type: ${image.type}`);
    if (image.size > 5 * 1024 * 1024) return jsonError("Image must be under 5 MB");
    const hint = form.get("hint");
    input = {
      kind: "image",
      data: Buffer.from(await image.arrayBuffer()).toString("base64"),
      mediaType: image.type as ImageType,
      hint: typeof hint === "string" && hint.trim() ? hint.trim() : undefined,
    };
  } else {
    const body = (await req.json().catch(() => null)) as { query?: string } | null;
    const query = body?.query?.trim();
    if (!query) return jsonError("Missing query");
    input = { kind: "text", query: query.slice(0, 500) };
  }

  try {
    return Response.json({ product: await identifyProduct(input) });
  } catch (err) {
    const { message, status } = describeAiError(err);
    return jsonError(message, status);
  }
}
