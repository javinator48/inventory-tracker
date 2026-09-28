import "server-only";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { copyImage, deleteImage } from "@/lib/storage";
import { ITEM_STATUSES, itemImages, items, type Item, type ItemStatus, type ItemWithImages } from "@/db/schema";

const optionalText = z.string().trim().max(5000).nullish().transform((v) => v || null);
const optionalMoney = z.coerce.number().min(0).nullish().or(z.literal("").transform(() => null));
const optionalDate = z.string().trim().nullish().transform((v) => v || null);

const itemFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(300),
  brand: optionalText,
  model: optionalText,
  category: optionalText,
  description: optionalText,
  upc: optionalText,
  condition: optionalText,
  quantity: z.coerce.number().int().min(1),
  location: optionalText,
  notes: optionalText,
  status: z.enum(ITEM_STATUSES),
  purchasePrice: optionalMoney,
  purchaseDate: optionalDate,
  msrp: optionalMoney,
  estimatedValue: optionalMoney,
  askingPrice: optionalMoney,
  soldPrice: optionalMoney,
  soldDate: optionalDate,
  soldPlatform: optionalText,
});

export const itemInputSchema = itemFieldsSchema.extend({
  quantity: itemFieldsSchema.shape.quantity.default(1),
  status: itemFieldsSchema.shape.status.default("owned"),
});

// Built from the default-free fields: a partial update must not reset quantity or status.
export const itemPatchSchema = itemFieldsSchema.partial();
export type ItemInput = z.infer<typeof itemInputSchema>;

const now = () => new Date().toISOString();
/** Today's date in the server's local timezone, as YYYY-MM-DD. */
const today = () => new Date().toLocaleDateString("en-CA");

/** The value an item is counted at: best estimate available, times quantity. */
export function itemValue(item: Pick<Item, "estimatedValue" | "msrp" | "purchasePrice" | "quantity">) {
  return (item.estimatedValue ?? item.msrp ?? item.purchasePrice ?? 0) * item.quantity;
}

async function attachImages(rows: Item[]): Promise<ItemWithImages[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const images = await db
    .select()
    .from(itemImages)
    .where(inArray(itemImages.itemId, rows.map((r) => r.id)))
    .orderBy(desc(itemImages.isPrimary), itemImages.id);
  return rows.map((r) => ({ ...r, images: images.filter((img) => img.itemId === r.id) }));
}

export async function listItems(opts: { status?: ItemStatus; query?: string; category?: string } = {}) {
  const db = await getDb();
  const conditions = [];
  if (opts.status) conditions.push(eq(items.status, opts.status));
  if (opts.category) conditions.push(eq(sql`lower(${items.category})`, opts.category.toLowerCase()));
  if (opts.query) {
    const q = `%${opts.query}%`;
    conditions.push(
      or(
        like(items.name, q),
        like(items.brand, q),
        like(items.model, q),
        like(items.category, q),
        like(items.description, q),
        like(items.notes, q),
        like(items.location, q),
        like(items.upc, q),
      ),
    );
  }
  const rows = await db
    .select()
    .from(items)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(items.updatedAt), desc(items.id));
  return attachImages(rows);
}

export async function getItem(id: number) {
  const db = await getDb();
  const rows = await db.select().from(items).where(eq(items.id, id));
  const [item] = await attachImages(rows);
  return item ?? null;
}

/** Stamps listedAt / valueUpdatedAt when the relevant fields change. */
function withDerivedFields(data: Partial<ItemInput>, existing?: Item) {
  const out: Partial<Item> = { ...data, updatedAt: now() };
  if (data.status === "for_sale" && existing?.status !== "for_sale") out.listedAt = now();
  if (data.status === "sold" && !data.soldDate && !existing?.soldDate) out.soldDate = today();
  if (data.estimatedValue !== undefined && data.estimatedValue !== existing?.estimatedValue) {
    out.valueUpdatedAt = now();
  }
  return out;
}

export async function createItem(data: ItemInput) {
  const db = await getDb();
  const [row] = await db
    .insert(items)
    .values({ ...withDerivedFields(data), name: data.name, createdAt: now() })
    .returning();
  return row;
}

export async function updateItem(id: number, data: Partial<ItemInput>) {
  const db = await getDb();
  const [existing] = await db.select().from(items).where(eq(items.id, id));
  if (!existing) return null;
  const [row] = await db.update(items).set(withDerivedFields(data, existing)).where(eq(items.id, id)).returning();
  return row;
}

export const saleSchema = z.object({
  /** How many units were sold; defaults to all of them. */
  quantity: z.coerce.number().int().min(1).optional(),
  soldPrice: optionalMoney,
  soldDate: optionalDate,
  soldPlatform: optionalText,
});

/**
 * Marks units of an item as sold. Selling only some of them splits the item: the original
 * keeps the unsold units and a sold copy (with copies of its photos) records the sale.
 */
export async function sellUnits(id: number, sale: z.infer<typeof saleSchema>) {
  const existing = await getItem(id);
  if (!existing) return null;
  const { quantity = existing.quantity, ...saleFields } = sale;
  if (quantity >= existing.quantity) {
    await updateItem(id, { status: "sold", ...saleFields });
    return { sold: (await getItem(id))!, remaining: null };
  }

  const db = await getDb();
  await db.update(items).set({ quantity: existing.quantity - quantity, updatedAt: now() }).where(eq(items.id, id));
  // Parsing keeps only the editable fields, dropping id, timestamps and images.
  const copy = await createItem(itemInputSchema.parse({ ...existing, ...saleFields, quantity, status: "sold" }));
  for (const img of existing.images) {
    await db.insert(itemImages).values({
      itemId: copy.id,
      path: await copyImage(img.path),
      source: img.source,
      isPrimary: img.isPrimary,
    });
  }
  return { sold: (await getItem(copy.id))!, remaining: (await getItem(id))! };
}

export async function deleteItem(id: number) {
  const db = await getDb();
  const images = await db.select().from(itemImages).where(eq(itemImages.itemId, id));
  await db.delete(items).where(eq(items.id, id));
  await Promise.all(images.map((img) => deleteImage(img.path)));
}

export async function addImage(itemId: number, path: string, source: "camera" | "upload" | "web" | "barcode") {
  const db = await getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(itemImages)
    .where(eq(itemImages.itemId, itemId));
  const [row] = await db
    .insert(itemImages)
    .values({ itemId, path, source, isPrimary: count === 0 })
    .returning();
  await db.update(items).set({ updatedAt: now() }).where(eq(items.id, itemId));
  return row;
}

export async function removeImage(itemId: number, imageId: number) {
  const db = await getDb();
  const [img] = await db
    .delete(itemImages)
    .where(and(eq(itemImages.id, imageId), eq(itemImages.itemId, itemId)))
    .returning();
  if (!img) return false;
  await deleteImage(img.path);
  if (img.isPrimary) {
    const [next] = await db.select().from(itemImages).where(eq(itemImages.itemId, itemId)).limit(1);
    if (next) await db.update(itemImages).set({ isPrimary: true }).where(eq(itemImages.id, next.id));
  }
  return true;
}

export async function setPrimaryImage(itemId: number, imageId: number) {
  const db = await getDb();
  await db.update(itemImages).set({ isPrimary: false }).where(eq(itemImages.itemId, itemId));
  await db
    .update(itemImages)
    .set({ isPrimary: true })
    .where(and(eq(itemImages.id, imageId), eq(itemImages.itemId, itemId)));
}

export type InventoryStats = Awaited<ReturnType<typeof getStats>>;

export async function getStats() {
  const db = await getDb();
  const all = await db.select().from(items);
  const held = all.filter((i) => i.status !== "sold");
  const forSale = all.filter((i) => i.status === "for_sale");
  const sold = all.filter((i) => i.status === "sold");
  const round = (n: number) => Math.round(n * 100) / 100;

  const withCost = held.filter((i) => i.purchasePrice != null);
  const soldWithCost = sold.filter((i) => i.purchasePrice != null && i.soldPrice != null);

  const byCategory = new Map<string, { value: number; count: number }>();
  for (const i of held) {
    const key = i.category?.trim() || "Uncategorized";
    const entry = byCategory.get(key) ?? { value: 0, count: 0 };
    entry.value += itemValue(i);
    entry.count += i.quantity;
    byCategory.set(key, entry);
  }

  const units = (list: Item[]) => list.reduce((s, i) => s + i.quantity, 0);

  return {
    /** Number of items (rows); an item with quantity 3 counts once. */
    counts: {
      owned: all.filter((i) => i.status === "owned").length,
      forSale: forSale.length,
      sold: sold.length,
      totalUnits: units(held),
    },
    /** Number of units, i.e. items weighted by quantity. */
    units: {
      owned: units(all.filter((i) => i.status === "owned")),
      forSale: units(forSale),
      sold: units(sold),
    },
    /** Estimated value of everything not yet sold (owned + for sale). */
    totalValue: round(held.reduce((s, i) => s + itemValue(i), 0)),
    /** Asking prices of listed items, falling back to their estimate. */
    forSaleValue: round(forSale.reduce((s, i) => s + (i.askingPrice != null ? i.askingPrice * i.quantity : itemValue(i)), 0)),
    /** What you paid for items still held that have a purchase price. */
    costBasis: round(withCost.reduce((s, i) => s + i.purchasePrice! * i.quantity, 0)),
    /** Estimated value minus cost, only for items with a known purchase price. */
    unrealizedGain: round(withCost.reduce((s, i) => s + itemValue(i) - i.purchasePrice! * i.quantity, 0)),
    itemsMissingValue: held.filter((i) => i.estimatedValue == null && i.msrp == null && i.purchasePrice == null).length,
    soldRevenue: round(sold.reduce((s, i) => s + (i.soldPrice ?? 0) * i.quantity, 0)),
    /** Sold price minus purchase price, only for sold items with both. */
    realizedProfit: round(soldWithCost.reduce((s, i) => s + (i.soldPrice! - i.purchasePrice!) * i.quantity, 0)),
    byCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, value: round(v.value), count: v.count }))
      .sort((a, b) => b.value - a.value),
    topItems: held
      .map((i) => ({ id: i.id, name: i.name, status: i.status, quantity: i.quantity, value: round(itemValue(i)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
  };
}
