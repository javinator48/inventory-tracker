import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/db/schema";
import { demoSessionId, DEMO_SEED_DB, DEMO_SESSION_DIR, removeDemoSessionFiles } from "@/lib/demo";
import { DEMO } from "@/lib/demo-shared";

const open = (url: string, authToken?: string) => {
  const client = createClient({ url, authToken });
  return { client, db: drizzle(client, { schema }) };
};
type Database = ReturnType<typeof open>["db"];

// Apply pending migrations once per server process, before the first query.
let main: Promise<Database> | undefined;

export async function getDb(): Promise<Database> {
  if (DEMO) return sessionDb(await demoSessionId());
  main ??= (async () => {
    const url = process.env.DATABASE_URL ?? "file:./data/inventory.db";
    if (url.startsWith("file:")) fs.mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), { recursive: true });
    const { client, db } = open(url, process.env.DATABASE_AUTH_TOKEN);
    await client.execute("PRAGMA foreign_keys = ON");
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
    return db;
  })();
  return main;
}

// Demo mode: each visitor gets a private copy of the (already migrated) demo database.
// Sandboxes are dropped after a day idle, or least-recently-used first past MAX_SESSIONS,
// since Cloud Run's disk is memory.
const MAX_SESSIONS = 150;
const IDLE_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, { opened: Promise<{ client: Client; db: Database }>; lastUsed: number }>();

async function sessionDb(id: string): Promise<Database> {
  const now = Date.now();
  let session = sessions.get(id);
  if (!session) {
    evict(now);
    session = {
      lastUsed: now,
      opened: (async () => {
        const file = path.join(DEMO_SESSION_DIR, `${id}.db`);
        fs.mkdirSync(DEMO_SESSION_DIR, { recursive: true });
        const fresh = !fs.existsSync(file);
        if (fresh) fs.copyFileSync(DEMO_SEED_DB, file);
        const opened = open(`file:${file}`);
        await opened.client.execute("PRAGMA foreign_keys = ON");
        if (fresh) {
          // Keep wishlist cooling-off dates as far in the future as they were when the demo was built.
          await opened.client.execute(`
            UPDATE items SET consider_until = date(consider_until, printf('%+d days',
              CAST(julianday('now') - julianday((SELECT value FROM settings WHERE key = 'demo_built')) AS INTEGER)))
            WHERE consider_until IS NOT NULL`);
        }
        return opened;
      })(),
    };
    sessions.set(id, session);
  }
  session.lastUsed = now;
  return (await session.opened).db;
}

function evict(now: number) {
  const byAge = [...sessions].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  const excess = byAge.length - MAX_SESSIONS + 1;
  byAge.forEach(([id, s], i) => {
    if (i >= excess && now - s.lastUsed < IDLE_MS) return;
    sessions.delete(id);
    void s.opened.then(({ client }) => client.close()).finally(() => removeDemoSessionFiles(id));
  });
}
