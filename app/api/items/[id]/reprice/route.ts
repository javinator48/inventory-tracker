import type { NextRequest } from "next/server";
import { jsonError, parseId } from "@/lib/api";
import { describeAiError } from "@/lib/ai/client";
import { estimateValue } from "@/lib/ai/identify";
import { getItem, updateItem } from "@/lib/items";

export const maxDuration = 180;

/** Re-estimates an item's resale value with Claude + web search and saves it. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/reprice">) {
  const id = parseId((await ctx.params).id);
  const item = id && (await getItem(id));
  if (!item) return jsonError("Item not found", 404);

  try {
    const estimate = await estimateValue(item);
    await updateItem(item.id, { estimatedValue: estimate.estimatedValue });
    return Response.json({ estimate, item: await getItem(item.id) });
  } catch (err) {
    const { message, status } = describeAiError(err);
    return jsonError(message, status);
  }
}
