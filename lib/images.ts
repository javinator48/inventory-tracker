import "server-only";

// Claude's web search returns pages, not image files, so image URLs it proposes are
// sometimes guesses. Only offer images that verifiably load, and add the preview image
// (og:image) of each source page, which is usually a real product photo.

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function isLoadableImage(url: string) {
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
      signal: AbortSignal.timeout(6_000),
    });
    const ok = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
    await res.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

const META_IMAGE = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi;
const CONTENT = /content=["']([^"']+)["']/i;

async function pagePreviewImages(pageUrl: string): Promise<string[]> {
  try {
    const res = await fetch(pageUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return [];
    // The meta tags are in <head>; don't read whole product pages.
    const html = (await res.text()).slice(0, 300_000);
    const urls = [...html.matchAll(META_IMAGE)]
      .map((m) => CONTENT.exec(m[0])?.[1]?.replaceAll("&amp;", "&"))
      .filter((u): u is string => Boolean(u))
      .map((u) => new URL(u, pageUrl).toString());
    return [...new Set(urls)];
  } catch {
    return [];
  }
}

/** Returns up to `max` image URLs that actually load: Claude's suggestions first, then source-page previews. */
export async function findWorkingImages(suggested: string[], sourcePages: string[], max = 4): Promise<string[]> {
  const fromPages = (await Promise.all(sourcePages.slice(0, 5).map(pagePreviewImages))).flat();
  const candidates = [...new Set([...suggested, ...fromPages])].filter((u) => /^https?:\/\//.test(u)).slice(0, 12);
  const checks = await Promise.all(candidates.map(async (u) => ((await isLoadableImage(u)) ? u : null)));
  return checks.filter((u): u is string => u != null).slice(0, max);
}
