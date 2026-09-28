import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Images are stored under UPLOAD_DIR and served by /api/images/[...path].
// Swap this module for an S3/R2 implementation when moving to the cloud.

const UPLOAD_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./data/uploads");

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([type, ext]) => [ext, type]),
);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function isSupportedImageType(type: string) {
  return type in EXT_BY_TYPE;
}

/** Saves image bytes and returns the storage key (a relative path). */
export async function saveImage(data: Buffer, contentType: string): Promise<string> {
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported image type: ${contentType}`);
  const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const file = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return key;
}

function resolveKey(key: string) {
  const file = path.resolve(UPLOAD_DIR, key);
  if (!file.startsWith(UPLOAD_DIR + path.sep)) throw new Error("Invalid image key");
  return file;
}

export async function readImage(key: string) {
  const file = resolveKey(key);
  const data = await fs.readFile(/*turbopackIgnore: true*/ file);
  return { data, contentType: TYPE_BY_EXT[path.extname(file).slice(1)] ?? "application/octet-stream" };
}

export async function deleteImage(key: string) {
  await fs.rm(resolveKey(key), { force: true });
}

/** Duplicates a stored image, for an item copied from another one. */
export async function copyImage(key: string): Promise<string> {
  const { data, contentType } = await readImage(key);
  return saveImage(data, contentType);
}

/** Downloads a remote image so the item doesn't depend on the source staying online. */
export async function downloadImage(url: string): Promise<{ data: Buffer; contentType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) image URLs are supported");
  }
  const res = await fetch(parsed, {
    headers: { "User-Agent": "Mozilla/5.0 (inventory-tracker image fetch)" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!isSupportedImageType(contentType)) throw new Error(`Not a supported image (${contentType || "unknown type"})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 10 MB");
  return { data, contentType };
}
