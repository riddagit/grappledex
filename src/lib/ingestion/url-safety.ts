/**
 * SSRF guard for admin URL ingestion. The admin surface is currently
 * unauthenticated, so this is load-bearing, not defense-in-depth. It is a
 * pragmatic scheme + host/IP-literal baseline and does NOT defend against DNS
 * rebinding (a hostname that resolves to a private IP after this check).
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Refusing to fetch a loopback host");
  }
  if (isPrivateAddress(host)) {
    throw new Error("Refusing to fetch a private, loopback, or link-local address");
  }
  return url;
}

function isPrivateAddress(host: string): boolean {
  if (host.includes(":")) {
    // IPv6 literal. URL.hostname keeps the surrounding brackets — strip them.
    host = host.replace(/^\[|\]$/g, "");
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7 ULA
    if (host.startsWith("fe80")) return true; // link-local
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host);
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;            // "this" network, loopback
  if (a === 10) return true;                         // private
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 169 && b === 254) return true;           // link-local / cloud metadata
  return false;
}
