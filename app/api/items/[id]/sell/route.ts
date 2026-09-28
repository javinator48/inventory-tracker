import type { NextRequest } from "next/server";
import { jsonError, parseId, validationError } from "@/lib/api";
import { saleSchema, sellUnits } from "@/lib/items";

/** Records a sale of `{ quantity?, soldPrice?, soldDate?, soldPlatform? }`; returns `{ sold, remaining }`. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/sell">) {
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Item not found", 404);
  const parsed = saleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const result = await sellUnits(id, parsed.data);
  return result ? Response.json(result) : jsonError("Item not found", 404);
}
