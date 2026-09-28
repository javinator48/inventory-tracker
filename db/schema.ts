import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ITEM_STATUSES = ["owned", "for_sale", "sold"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  brand: text("brand"),
  model: text("model"),
  category: text("category"),
  description: text("description"),
  upc: text("upc"),
  condition: text("condition"),
  quantity: integer("quantity").notNull().default(1),
  location: text("location"),
  notes: text("notes"),
  status: text("status", { enum: ITEM_STATUSES }).notNull().default("owned"),

  purchasePrice: real("purchase_price"),
  purchaseDate: text("purchase_date"),
  msrp: real("msrp"),
  estimatedValue: real("estimated_value"),
  valueUpdatedAt: text("value_updated_at"),

  askingPrice: real("asking_price"),
  listedAt: text("listed_at"),

  soldPrice: real("sold_price"),
  soldDate: text("sold_date"),
  soldPlatform: text("sold_platform"),

  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const itemImages = sqliteTable("item_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  source: text("source", { enum: ["camera", "upload", "web", "barcode"] }).notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  // Plain text for display; the assistant's tool calls aren't persisted.
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemImage = typeof itemImages.$inferSelect;
export type ItemWithImages = Item & { images: ItemImage[] };
