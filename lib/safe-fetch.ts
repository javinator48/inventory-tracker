import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

// Server-side fetches of URLs that came from users or the model (image downloads, page
// previews) must not reach this machine's own network: localhost, the LAN, Tailscale, or a
// cloud metadata server. Each redirect hop is checked too.

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

function isBlocked(ip: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  return blocked.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isBlocked(a.address))) {
    throw new Error("That address isn't allowed");
  }
}

/** fetch() for untrusted http(s) URLs: refuses private and internal addresses, following up to 5 redirects. */
export async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are supported");
    await assertPublicHost(url.hostname);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    if (hop >= 5) throw new Error("Too many redirects");
    url = new URL(location, url);
  }
}
