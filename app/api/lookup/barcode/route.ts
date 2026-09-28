import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/api";
import { describeAiError } from "@/lib/ai/client";
import { identifyProduct } from "@/lib/ai/identify";
import { lookupUpcItemDb, normalizeBarcode } from "@/lib/barcode";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { upc?: string } | null;
  const upc = normalizeBarcode(body?.upc ?? "");
  if (!upc) return jsonError("That doesn't look like a product barcode (expected 8-14 digits)");

  const result = await lookupUpcItemDb(upc);
  if (result.status === "found") return Response.json({ product: result.product });

  const note = result.status === "not_found" ? "Not in UPCitemdb" : result.reason;
  try {
    const product = await identifyProduct({ kind: "upc", upc });
    return Response.json({ product: { ...product, upc: product.upc ?? upc }, note: `${note}; found with Claude web search` });
  } catch (err) {
    const { message, status } = describeAiError(err);
    return jsonError(`${note}. ${message}`, status);
  }
}
