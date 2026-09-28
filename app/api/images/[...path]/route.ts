import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/api";
import { readImage } from "@/lib/storage";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/images/[...path]">) {
  const { path } = await ctx.params;
  try {
    const { data, contentType } = await readImage(path.join("/"));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        // Keys are random UUIDs and never reused, so the file never changes.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return jsonError("Image not found", 404);
  }
}
