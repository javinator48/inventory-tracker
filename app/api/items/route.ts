import type { NextRequest } from "next/server";
import { ITEM_STATUSES, type ItemStatus } from "@/db/schema";
import { jsonError, validationError } from "@/lib/api";
import { createItem, getItem, itemInputSchema, listItems } from "@/lib/items";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  if (status && !ITEM_STATUSES.includes(status as ItemStatus)) return jsonError("Unknown status");
  const items = await listItems({
    status: (status as ItemStatus) || undefined,
    query: params.get("q") || undefined,
    category: params.get("category") || undefined,
  });
  return Response.json(items);
}

export async function POST(req: NextRequest) {
  const parsed = itemInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const row = await createItem(parsed.data);
  return Response.json(await getItem(row.id), { status: 201 });
}
