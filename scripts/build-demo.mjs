// Builds demo/inventory.db, the pristine database every demo visitor's sandbox is copied from.
// Usage: node scripts/build-demo.mjs   (photos come from scripts/fetch-demo-images.py)
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const root = path.resolve(import.meta.dirname, "..");
const dbFile = path.join(root, "demo/inventory.db");
const items = JSON.parse(fs.readFileSync(path.join(root, "demo/items.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const addDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

fs.rmSync(dbFile, { force: true });
const client = createClient({ url: `file:${dbFile}` });
await migrate(drizzle(client), { migrationsFolder: path.join(root, "db/migrations") });

const columns = {
  name: "name", brand: "brand", model: "model", category: "category", description: "description",
  condition: "condition", quantity: "quantity", location: "location", notes: "notes", status: "status", joy: "joy",
  purchasePrice: "purchase_price", purchaseDate: "purchase_date", msrp: "msrp", estimatedValue: "estimated_value",
  askingPrice: "asking_price", listedAt: "listed_at", soldPrice: "sold_price", soldDate: "sold_date", soldPlatform: "sold_platform",
};

const ids = [];
for (const [i, item] of items.entries()) {
  const row = Object.fromEntries(Object.entries(columns).filter(([k]) => item[k] != null).map(([k, col]) => [col, item[k]]));
  if (item.considerDays != null) row.consider_until = addDays(item.considerDays);
  row.value_updated_at = `${today} 09:00:00`;
  // Look like they were added when bought, not all at once.
  row.created_at = row.updated_at = `${item.purchaseDate ?? addDays(-(i % 20) - 1)} 12:00:00`;
  const names = Object.keys(row);
  const res = await client.execute({
    sql: `INSERT INTO items (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    args: Object.values(row),
  });
  const id = Number(res.lastInsertRowid);
  ids.push(id);
  const photo = `demo/${String(i).padStart(2, "0")}.jpg`;
  if (fs.existsSync(path.join(root, "demo/uploads", photo))) {
    await client.execute({
      sql: "INSERT INTO item_images (item_id, path, source, is_primary) VALUES (?, ?, 'web', 1)",
      args: [id, photo],
    });
  }
}

// One wishlist item comes with a "Before you buy" check already done, to show what it looks like.
const byModel = (model) => ids[items.findIndex((it) => it.model === model)];
const omega = byModel("Speedmaster X-33");
if (omega) {
  const watch = (model, rest) => ({ id: byModel(model), name: items.find((it) => it.model === model).name, ...rest });
  const check = {
    verdict: "wait",
    headline: "A watch with a great story, but you already wear two automatics you love, and this would be your most expensive item by far.",
    reasoning:
      "You own a Fortis Flieger GMT pilot watch and a Citizen Promaster diver. The Fortis sparks joy and already covers the travel/GMT role the X-33 is known for; the Citizen covers rugged everyday wear. The X-33 would be a third steel-and-black-dial sports watch, and at $6,400 it's more than your next four most valuable items combined. The space-history story is a real reason to want it, so give it the full cooling-off period and see whether it's the watch or the story you keep thinking about.",
    questions: [
      "Which of your two watches would you wear less if you had the X-33?",
      "Is it the X-33 specifically, or would a classic Moonwatch scratch the same itch?",
      "Would you still want it if nobody ever asked about your watch?",
    ],
    similarItems: [
      watch("Flieger GMT", { relation: "similar", reason: "Already your travel watch with a second time zone, and it sparks joy" }),
      watch("Promaster Diver 200m", { relation: "similar", reason: "Black-dial steel sports watch for everyday wear" }),
    ],
    letGo: [watch("Promaster Diver 200m", { reason: "Rated neutral; if the X-33 comes in, this is the one that would sit in the drawer" })],
    checkedAt: new Date().toISOString(),
  };
  await client.execute({ sql: "UPDATE items SET buy_check = ? WHERE id = ?", args: [JSON.stringify(check), omega] });
}

// Sandboxes shift wishlist dates by the days since this build, so cooling-off periods stay in the future.
await client.execute({ sql: "INSERT INTO settings (key, value) VALUES ('demo_built', ?)", args: [today] });
client.close();
console.log(`Wrote ${dbFile}: ${ids.length} items`);
