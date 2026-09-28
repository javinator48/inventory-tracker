import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/db/schema";

const url = process.env.DATABASE_URL ?? "file:./data/inventory.db";

if (url.startsWith("file:")) {
  fs.mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), { recursive: true });
}

const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
const database = drizzle(client, { schema });

// Apply pending migrations once per server process, before the first query.
let ready: Promise<void> | undefined;

export async function getDb() {
  ready ??= (async () => {
    await client.execute("PRAGMA foreign_keys = ON");
    await migrate(database, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
  })();
  await ready;
  return database;
}
