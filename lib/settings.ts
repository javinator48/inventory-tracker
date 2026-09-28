import "server-only";
import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { getDb } from "@/lib/db";
import { deleteImage, readImage } from "@/lib/storage";

export async function getSetting(key: string) {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  const db = await getDb();
  if (value == null) await db.delete(settings).where(eq(settings.key, key));
  else await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

const ME_PHOTO = "me_photo";

/** Storage key of the user's saved photo for try-ons, if any. */
export const getMePhoto = () => getSetting(ME_PHOTO);

/** Replaces the saved photo (deleting the old file), or clears it with null. */
export async function setMePhoto(key: string | null) {
  const previous = await getMePhoto();
  await setSetting(ME_PHOTO, key);
  if (previous && previous !== key) await deleteImage(previous);
}

/** True if the key names a stored image; guards keys passed in by clients or the model. */
export async function imageExists(key: string) {
  try {
    await readImage(key);
    return true;
  } catch {
    return false;
  }
}
