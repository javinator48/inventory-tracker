// Public demo mode (DEMO_MODE=1). Shared by proxy.ts and server code, so no "server-only" here.
//
// In demo mode every visitor gets a private copy of the demo database, keyed by a cookie, and
// the AI endpoints are rate limited so strangers can't run up the API bill. Counters live in
// memory, which is accurate because the demo runs as a single instance (Cloud Run --max-instances=1).

export const DEMO = process.env.DEMO_MODE === "1";

export const DEMO_COOKIE = "demo_session";
/** Set by proxy.ts from the cookie; the client can't spoof it because proxy always overwrites it. */
export const DEMO_SESSION_HEADER = "x-demo-session";

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DAY = 24 * 60 * 60 * 1000;

type Limit = { perVisitor: number; total: number };

/** Daily caps per visitor (cookie and IP, whichever is hit first) and across everyone. */
const LIMITS: Record<string, Limit> = {
  ai: { perVisitor: 30, total: 600 },
  tryOn: { perVisitor: 3, total: 40 },
  upload: { perVisitor: 40, total: 1500 },
};

/** Which POST endpoints count against which limit. */
export function limitFor(method: string, pathname: string): keyof typeof LIMITS | null {
  if (method !== "POST") return null;
  if (pathname === "/api/outfits/try-on") return "tryOn";
  if (
    pathname === "/api/chat" ||
    pathname === "/api/identify" ||
    pathname === "/api/buy-check" ||
    pathname === "/api/outfits" ||
    pathname === "/api/lookup/barcode" ||
    /^\/api\/items\/\d+\/reprice$/.test(pathname)
  ) {
    return "ai";
  }
  if (pathname === "/api/uploads" || /^\/api\/items\/\d+\/images$/.test(pathname)) return "upload";
  return null;
}

const counters = new Map<string, { count: number; resetAt: number }>();

function bump(key: string, max: number, now: number) {
  let c = counters.get(key);
  if (!c || c.resetAt <= now) {
    c = { count: 0, resetAt: now + DAY };
    counters.set(key, c);
  }
  if (c.count >= max) return false;
  c.count++;
  return true;
}

/** Counts one use; returns an error message if a limit is reached. */
export function takeDemoQuota(kind: keyof typeof LIMITS, session: string, ip: string): string | null {
  const now = Date.now();
  if (counters.size > 50_000) for (const [k, c] of counters) if (c.resetAt <= now) counters.delete(k);
  const { perVisitor, total } = LIMITS[kind];
  const what = kind === "tryOn" ? "try-on images" : kind === "upload" ? "photo uploads" : "AI requests";
  if (!bump(`${kind}:all`, total, now)) return `The demo has used up today's ${what}. Try again tomorrow.`;
  if (!bump(`${kind}:s:${session}`, perVisitor, now) || !bump(`${kind}:ip:${ip}`, perVisitor, now)) {
    return `You've used this demo's ${perVisitor} ${what} for today. Try again tomorrow.`;
  }
  return null;
}
