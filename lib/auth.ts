// Optional single-password gate, enabled by setting APP_PASSWORD.
// Runs in the proxy, so it only uses Web Crypto.

export const AUTH_COOKIE = "inventory_auth";

export function authEnabled() {
  return Boolean(process.env.APP_PASSWORD);
}

/** The cookie holds a hash of the password, so changing APP_PASSWORD signs everyone out. */
export async function authToken(password = process.env.APP_PASSWORD ?? "") {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`inventory-tracker:${password}`));
  return Buffer.from(digest).toString("base64url");
}
