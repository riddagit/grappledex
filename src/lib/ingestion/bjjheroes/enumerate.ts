export type FetchText = (url: string) => Promise<string>;

export const SITEMAP_URLS = [
  "https://www.bjjheroes.com/post-sitemap.xml",
  "https://www.bjjheroes.com/post-sitemap2.xml",
  "https://www.bjjheroes.com/post-sitemap3.xml",
];

const FIGHTER_PATH = "/bjj-fighters/";

export async function fighterProfileUrls(fetchText: FetchText): Promise<string[]> {
  const seen = new Set<string>();
  for (const sitemap of SITEMAP_URLS) {
    const xml = await fetchText(sitemap);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const url = m[1];
      if (url && url.includes(FIGHTER_PATH)) seen.add(url);
    }
  }
  return [...seen];
}
