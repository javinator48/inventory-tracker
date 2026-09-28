import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, authToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
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

export const config = {
  // Everything except the login page/route and static assets.
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
