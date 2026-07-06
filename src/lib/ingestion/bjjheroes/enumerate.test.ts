import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fighterProfileUrls } from "./enumerate";

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, "__fixtures__/post-sitemap.xml"), "utf8");

it("returns unique fighter profile URLs and drops non-fighter URLs", async () => {
  const fetchText = async () => xml; // every sitemap returns the same fixture
  const urls = await fighterProfileUrls(fetchText);
  expect(urls).toContain("https://www.bjjheroes.com/bjj-fighters/gordon-ryan");
  expect(urls).toContain("https://www.bjjheroes.com/bjj-fighters/felipe-pena");
  expect(urls.some((u) => u.includes("/bjj-news/"))).toBe(false);
  expect(new Set(urls).size).toBe(urls.length); // deduped across sitemaps
});
