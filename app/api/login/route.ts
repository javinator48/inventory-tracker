import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

// Relative redirects, so this works behind a reverse proxy (e.g. tailscale serve).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return new Response(null, { status: 303, headers: { Location: "/login?error=1" } });
  }

  const secure = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `${AUTH_COOKIE}=${await authToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${secure}`,
    },
  });
}
