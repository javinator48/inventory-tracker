import type { NextRequest } from "next/server";
import { jsonError, parseId, validationError } from "@/lib/api";
import { deleteItem, getItem, itemPatchSchema, updateItem } from "@/lib/items";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/items/[id]">) {
  const id = parseId((await ctx.params).id);
  const item = id && (await getItem(id));
  return item ? Response.json(item) : jsonError("Item not found", 404);
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/items/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Item not found", 404);
  const parsed = itemPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const row = await updateItem(id, parsed.data);
  return row ? Response.json(await getItem(id)) : jsonError("Item not found", 404);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/items/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id || !(await getItem(id))) return jsonError("Item not found", 404);
  await deleteItem(id);
  return new Response(null, { status: 204 });
}
