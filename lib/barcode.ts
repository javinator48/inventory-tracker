import "server-only";
import { findWorkingImages } from "@/lib/images";
import type { ProductInfo } from "@/lib/types";

// UPCitemdb free trial endpoint: no key, ~100 lookups/day per IP.
const TRIAL_URL = "https://api.upcitemdb.com/prod/trial/lookup";

type UpcItemDbItem = {
  title?: string;
  description?: string;
  upc?: string;
  ean?: string;
  brand?: string;
  model?: string;
  category?: string;
  lowest_recorded_price?: number;
  highest_recorded_price?: number;
  images?: string[];
  offers?: { title?: string; link?: string; merchant?: string; list_price?: number | string; price?: number | string }[];
};

export type BarcodeLookupResult =
  | { status: "found"; product: ProductInfo }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

export function normalizeBarcode(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/** Looks a barcode up in UPCitemdb. "unavailable" means the caller should fall back to AI. */
export async function lookupUpcItemDb(upc: string): Promise<BarcodeLookupResult> {
  let res: Response;
  try {
    res = await fetch(`${TRIAL_URL}?upc=${encodeURIComponent(upc)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: "unavailable", reason: "UPCitemdb could not be reached" };
  }
  if (res.status === 429) return { status: "unavailable", reason: "UPCitemdb daily limit reached" };
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) return { status: "unavailable", reason: `UPCitemdb error ${res.status}` };

  const body = (await res.json().catch(() => null)) as { items?: UpcItemDbItem[] } | null;
  const item = body?.items?.[0];
  if (!item?.title) return { status: "not_found" };

  // UPCitemdb has no MSRP field; the highest list price across offers is the closest proxy.
  const listPrices = (item.offers ?? []).map((o) => num(o.list_price)).filter((n): n is number => n != null);
  const msrp = listPrices.length ? Math.max(...listPrices) : num(item.highest_recorded_price);

  const sources = (item.offers ?? [])
    .filter((o) => o.link)
    .slice(0, 3)
    .map((o) => ({ title: o.merchant || o.title || "Retailer", url: o.link! }));

  return {
    status: "found",
    product: {
      name: item.title,
      brand: item.brand || null,
      model: item.model || null,
      category: item.category?.split(">").pop()?.trim() || null,
      description: item.description || null,
      upc: item.upc || item.ean || upc,
      msrp,
      estimatedValue: null,
      // Offer links are redirect trackers, so only the listed images are checked.
      imageUrls: await findWorkingImages(item.images ?? [], [], 6),
      sources,
      confidence: "high",
      provider: "upcitemdb",
    },
  };
}
