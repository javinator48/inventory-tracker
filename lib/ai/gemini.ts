import "server-only";

// Try-on images come from Google Gemini's image model, since Claude reads images but
// doesn't generate them. Uses the Interactions REST API directly (no SDK dependency).

const API_URL = process.env.GEMINI_API_URL ?? "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("Try-on images need GEMINI_API_KEY in .env.local");
  }
}

type InputImage = { data: Buffer; contentType: string };

/** Finds the first image block anywhere in the response (it's in steps[].content[]). */
function findImage(node: unknown): { data: string; mime_type?: string } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findImage(child);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === "image" && typeof obj.data === "string") return obj as { data: string; mime_type?: string };
  for (const value of Object.values(obj)) {
    const found = findImage(value);
    if (found) return found;
  }
  return null;
}

/**
 * Renders the person in the photo wearing the given garments. `garments[i].label`
 * describes each garment image; `extra` lists pieces that have no photo.
 */
export async function renderTryOn(opts: {
  person: InputImage;
  garments: (InputImage & { label: string })[];
  extra: string[];
  outfit: string;
}): Promise<{ data: Buffer; contentType: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiNotConfiguredError();

  const pieces = [
    ...opts.garments.map((g, i) => `Image ${i + 2}: ${g.label}`),
    ...opts.extra.map((e) => `No photo: ${e}`),
  ].join("\n");
  const prompt = `Virtual try-on. Image 1 is a photo of a person. Create a realistic full-length photo of this same person wearing the outfit below.
Keep their face, hair, skin tone, body shape and pose recognisably the same. Reproduce each garment's colour, pattern, fabric and cut faithfully from its image; for pieces without a photo, follow the description. Plain, softly lit background. Don't add text, logos or extra accessories.

Outfit: ${opts.outfit}
${pieces}`;

  const input = [
    { type: "text", text: prompt },
    { type: "image", mime_type: opts.person.contentType, data: opts.person.data.toString("base64") },
    ...opts.garments.map((g) => ({ type: "image", mime_type: g.contentType, data: g.data.toString("base64") })),
  ];

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input,
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "3:4", image_size: "1K" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    // Errors come as { error } or, e.g. for billing, as [{ error }].
    const error = (Array.isArray(body) ? body[0] : body) as { error?: { message?: string } } | null;
    const message = error?.error?.message?.trim();
    if (res.status === 401 || res.status === 403) throw new Error("The Gemini API key was rejected");
    if (res.status === 402) throw new Error("Gemini: your AI Studio prepaid credits are used up. Add credits at https://ai.studio/projects");
    // 429 also covers free-tier keys with zero quota for the image model, so pass Gemini's reason through.
    if (res.status === 429) throw new Error(message ? `Gemini: ${message}` : "Gemini is rate limited, try again in a minute");
    throw new Error(`Gemini image error (${res.status})${message ? `: ${message}` : ""}`);
  }
  const image = findImage(body);
  if (!image) throw new Error("Gemini didn't return an image. It may have declined this photo; try a different one.");
  return { data: Buffer.from(image.data, "base64"), contentType: image.mime_type ?? "image/jpeg" };
}
