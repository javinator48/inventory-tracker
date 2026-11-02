import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { DEMO_SESSION_HEADER, SESSION_ID } from "@/lib/demo-shared";

/** Where uploaded photos are stored (lib/storage.ts); here so demo cleanup can use it without an import cycle. */
export const UPLOAD_ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./data/uploads");

/** The pristine, migrated demo database that each visitor's sandbox is copied from (scripts/build-demo.mjs). */
export const DEMO_SEED_DB = path.resolve(/*turbopackIgnore: true*/ process.env.DEMO_SEED_DB ?? "./demo/inventory.db");
export const DEMO_SESSION_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DEMO_SESSION_DIR ?? "/tmp/demo-sessions");

/** The current request's sandbox id, set by proxy.ts. */
export async function demoSessionId() {
  const id = (await headers()).get(DEMO_SESSION_HEADER);
  if (!id || !SESSION_ID.test(id)) throw new Error("Missing demo session");
  return id;
}

/** Storage-key prefix for a sandbox's own uploads; everything else under UPLOAD_ROOT is shared demo data. */
export const demoUploadPrefix = (id: string) => `s/${id}/`;

export async function removeDemoSessionFiles(id: string) {
  await fs.rm(path.join(DEMO_SESSION_DIR, `${id}.db`), { force: true });
  await fs.rm(path.join(UPLOAD_ROOT, demoUploadPrefix(id)), { recursive: true, force: true });
}
