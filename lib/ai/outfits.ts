import "server-only";
import type { BetaContentBlockParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { ItemWithImages } from "@/db/schema";
import { listItems } from "@/lib/items";
import { getMePhoto, imageExists } from "@/lib/settings";
import { readImage, saveImage } from "@/lib/storage";
import type { OutfitSuggestion } from "@/lib/types";
import { geminiConfigured, GeminiNotConfiguredError, renderTryOn } from "./gemini";
import { researchAndRecord } from "./identify";
import { KONMARI_GUIDANCE } from "./konmari";

/** A piece the user is thinking of buying: a stored photo, a name, or both. */
export const newPieceSchema = z
  .object({ imageKey: z.string().nullish(), name: z.string().trim().max(300).nullish() })
  .refine((p) => p.imageKey || p.name, "Each piece needs a photo or a name");
export type NewPiece = z.infer<typeof newPieceSchema>;


// Items that look like things you wear, so their photos can be shown to Claude.
const WEARABLE =
  /cloth|apparel|fashion|wear|shirt|tee|top|blouse|sweater|hoodie|jacket|coat|pant|trouser|jean|short|skirt|dress|suit|shoe|sneaker|boot|footwear|hat|cap|scarf|belt|bag|accessor|watch|jewel/i;
const MAX_WARDROBE_PHOTOS = 16;
const VIEWABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_VIEWABLE_BYTES = 3_700_000;

const RECORD_TOOL: BetaTool = {
  name: "record_outfits",
  description: "Record the outfit pairings. Call this exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      newItems: {
        type: "array",
        description: "One entry per piece they're considering, in the order given",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short name, e.g. \"Olive chore jacket\"" },
            category: { type: ["string", "null"], description: "Clothing, Shoes or Accessories when it's wearable" },
            description: { type: "string", description: "Colour, material, cut, style in one sentence" },
          },
          required: ["name", "category", "description"],
          additionalProperties: false,
        },
      },
      outfits: {
        type: "array",
        description: "2-4 outfits, best first. Each combines at least one new piece with things they own",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short name for the look" },
            occasion: { type: "string", description: "Where they'd wear it" },
            why: { type: "string", description: "1-2 sentences on why these pieces work together" },
            ownedItemIds: { type: "array", items: { type: "integer" }, description: "Inventory ids of owned pieces" },
            newItemIndexes: { type: "array", items: { type: "integer" }, description: "0-based indexes into newItems" },
          },
          required: ["title", "occasion", "why", "ownedItemIds", "newItemIndexes"],
          additionalProperties: false,
        },
      },
      overlaps: {
        type: "array",
        description: "New pieces that closely duplicate something they already own",
        items: {
          type: "object",
          properties: {
            newItemIndex: { type: "integer" },
            ownedItemId: { type: "integer" },
            note: { type: "string" },
          },
          required: ["newItemIndex", "ownedItemId", "note"],
          additionalProperties: false,
        },
      },
      advice: {
        type: "string",
        description: "1-2 sentences: how well the new pieces fit their wardrobe, in the spirit of buying only what sparks joy",
      },
    },
    required: ["newItems", "outfits", "overlaps", "advice"],
    additionalProperties: false,
  },
};

const recordSchema = z.object({
  newItems: z.array(z.object({ name: z.string(), category: z.string().nullable(), description: z.string() })),
  outfits: z.array(
    z.object({
      title: z.string(),
      occasion: z.string(),
      why: z.string(),
      ownedItemIds: z.array(z.number()),
      newItemIndexes: z.array(z.number()),
    }),
  ),
  overlaps: z.array(z.object({ newItemIndex: z.number(), ownedItemId: z.number(), note: z.string() })),
  advice: z.string(),
});

const SYSTEM = `You are a thoughtful personal stylist. The user is thinking of buying one or more pieces and wants to see how they'd wear them with clothes they already own.
You get photos and/or names of the new pieces, and their inventory. Build outfits mostly from things they own, so each new piece earns its place. Only use owned items that are wearable (clothes, shoes, bags, watches, jewellery and other accessories). If they own few or no clothes, say so in advice and keep outfits to what's possible.
Point out when a new piece closely duplicates something they own. Only use web search if you can't tell what a named piece is.

${KONMARI_GUIDANCE}

Call record_outfits once when you're done.`;

async function photoBlock(key: string): Promise<BetaContentBlockParam | null> {
  try {
    const { data, contentType } = await readImage(key);
    if (!VIEWABLE.has(contentType) || data.length > MAX_VIEWABLE_BYTES) return null;
    return {
      type: "image",
      source: { type: "base64", media_type: contentType as "image/jpeg", data: data.toString("base64") },
    };
  } catch {
    return null;
  }
}

const cover = (item: ItemWithImages) => (item.images.find((i) => i.isPrimary) ?? item.images[0])?.path ?? null;

/** Suggests outfits pairing the new pieces with what the user owns. */
export async function suggestOutfits(pieces: NewPiece[]): Promise<{ suggestion: OutfitSuggestion; items: ItemWithImages[] }> {
  for (const p of pieces) {
    if (p.imageKey && !(await imageExists(p.imageKey))) throw new Error("A piece's photo couldn't be found");
  }
  const held = (await listItems()).filter((i) => i.status === "owned" || i.status === "for_sale");
  const wearable = held.filter((i) => WEARABLE.test(`${i.category ?? ""} ${i.name}`));

  const content: BetaContentBlockParam[] = [{ type: "text", text: "Pieces they're considering:" }];
  for (const [index, p] of pieces.entries()) {
    content.push({ type: "text", text: `New piece ${index}${p.name ? `: ${p.name}` : ""}` });
    const block = p.imageKey ? await photoBlock(p.imageKey) : null;
    if (block) content.push(block);
  }

  const photographed = wearable.filter((i) => cover(i)).slice(0, MAX_WARDROBE_PHOTOS);
  if (photographed.length) content.push({ type: "text", text: "Photos of wearable things they own:" });
  for (const item of photographed) {
    const block = await photoBlock(cover(item)!);
    if (!block) continue;
    content.push({ type: "text", text: `Owned item ${item.id}: ${item.name}` });
    content.push(block);
  }

  const inventory = held.map((i) => ({
    id: i.id,
    name: i.name,
    brand: i.brand,
    category: i.category,
    description: i.description?.slice(0, 160) ?? null,
    joy: i.joy,
  }));
  content.push({ type: "text", text: `Their full inventory (${inventory.length} items):\n${JSON.stringify(inventory)}` });

  const r = recordSchema.parse(await researchAndRecord(content, RECORD_TOOL, SYSTEM));

  // Keep only real ids and indexes, and pad newItems if the model skipped one.
  const byId = new Map(held.map((i) => [i.id, i]));
  const newItems = pieces.map((p, i) => r.newItems[i] ?? { name: p.name ?? `Piece ${i + 1}`, category: null, description: "" });
  const validIndex = (n: number) => Number.isInteger(n) && n >= 0 && n < pieces.length;
  const outfits = r.outfits
    .map((o) => ({ ...o, ownedItemIds: o.ownedItemIds.filter((id) => byId.has(id)), newItemIndexes: o.newItemIndexes.filter(validIndex) }))
    .filter((o) => o.ownedItemIds.length + o.newItemIndexes.length > 0);
  const overlaps = r.overlaps.filter((o) => validIndex(o.newItemIndex) && byId.has(o.ownedItemId));
  const ids = new Set([...outfits.flatMap((o) => o.ownedItemIds), ...overlaps.map((o) => o.ownedItemId)]);

  return {
    suggestion: { newItems, outfits, overlaps, advice: r.advice },
    items: held.filter((i) => ids.has(i.id)),
  };
}

export const tryOnInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownedItemIds: z.array(z.number().int()).max(8),
  newItems: z.array(z.object({ imageKey: z.string().nullish(), name: z.string().trim().min(1).max(300) })).max(4),
});

export class NoMePhotoError extends Error {
  constructor() {
    super("Add a photo of yourself first (Try it on → Your photo).");
  }
}

/** Renders the user's saved photo wearing the outfit and stores the result. Returns its storage key. */
export async function tryOnOutfit(input: z.infer<typeof tryOnInputSchema>): Promise<string> {
  if (!geminiConfigured()) throw new GeminiNotConfiguredError();
  const meKey = await getMePhoto();
  if (!meKey) throw new NoMePhotoError();
  const person = await readImage(meKey);

  const owned = (await listItems()).filter((i) => input.ownedItemIds.includes(i.id));
  const garments: { data: Buffer; contentType: string; label: string }[] = [];
  const extra: string[] = [];

  for (const piece of input.newItems) {
    if (piece.imageKey && (await imageExists(piece.imageKey))) garments.push({ ...(await readImage(piece.imageKey)), label: piece.name });
    else extra.push(piece.name);
  }
  for (const item of owned) {
    const label = [item.name, item.description?.slice(0, 120)].filter(Boolean).join(": ");
    const key = cover(item);
    if (key && garments.length < 10) garments.push({ ...(await readImage(key)), label });
    else extra.push(label);
  }

  const image = await renderTryOn({
    person,
    garments,
    extra,
    outfit: input.title,
  });
  return saveImage(image.data, image.contentType);
}
