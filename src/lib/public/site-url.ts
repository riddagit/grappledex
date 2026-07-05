// Single source of the public origin. Production domain is set via
// NEXT_PUBLIC_SITE_URL; the fallback is the canonical rollvault.net origin.
export function siteUrl(path: string): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://rollvault.net")
    .replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}
