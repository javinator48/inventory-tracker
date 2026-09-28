// Types shared between server routes and client components.

import type { ItemWithImages } from "@/db/schema";

export type ProductInfo = {
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  description: string | null;
  upc: string | null;
  msrp: number | null;
  estimatedValue: number | null;
  imageUrls: string[];
  sources: { title: string; url: string }[];
  /** How sure the lookup is that it found the right product. */
  confidence: "high" | "medium" | "low" | null;
  /** Where the details came from. */
  provider: "upcitemdb" | "claude";
};

export type ValueEstimate = {
  estimatedValue: number;
  low: number | null;
  high: number | null;
  reasoning: string;
  sources: { title: string; url: string }[];
};

/** Events streamed from /api/chat as newline-delimited JSON. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "status"; status: string }
  | { type: "item_saved"; item: ItemWithImages }
  | { type: "proposal"; proposal: ItemProposal }
  | { type: "done" }
  | { type: "error"; error: string };

/** An edit the assistant suggested; saved only when the user taps Apply. */
export type ItemProposal = {
  id: string;
  itemId: number;
  itemName: string;
  changes: { field: string; from: string | number | null; to: string | number | null }[];
  /** Body for PATCH /api/items/[id]. */
  patch: Record<string, string | number | null>;
};
