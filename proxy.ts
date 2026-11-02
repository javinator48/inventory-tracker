import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, authToken } from "@/lib/auth";
import { DEMO, DEMO_COOKIE, DEMO_SESSION_HEADER, limitFor, SESSION_ID, takeDemoQuota } from "@/lib/demo-shared";

export async function proxy(request: NextRequest) {
  if (DEMO) return demo(request);
  if (!authEnabled()) return NextResponse.next();
  if (request.cookies.get(AUTH_COOKIE)?.value === (await authToken())) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  // Proxy redirects must be absolute; nextUrl carries the host the browser used.
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

/** Demo mode: no password; each browser gets its own sandbox (see lib/db.ts), and AI use is capped. */
function demo(request: NextRequest) {
  const existing = request.cookies.get(DEMO_COOKIE)?.value;
  const session = existing && SESSION_ID.test(existing) ? existing : crypto.randomUUID();

  const kind = limitFor(request.method, request.nextUrl.pathname);
  if (kind) {
    // Cloud Run appends the real client address as the last X-Forwarded-For entry.
    const ip = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
    const error = takeDemoQuota(kind, session, ip);
    if (error) return Response.json({ error }, { status: 429 });
  }

  const headers = new Headers(request.headers);
  headers.set(DEMO_SESSION_HEADER, session);
  const response = NextResponse.next({ request: { headers } });
  if (session !== existing) {
    response.cookies.set(DEMO_COOKIE, session, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return response;
}

export const config = {
  // Everything except the login page/route and static assets.
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
