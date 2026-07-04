import type { MetadataRoute } from "next";
import { db } from "@/db/client";
import { listPublicUrls } from "@/lib/public/sitemap";
import { siteUrl } from "@/lib/public/site-url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const urls = await listPublicUrls(db);
  return urls.map((u) => ({
    url: siteUrl(u.path),
    lastModified: u.lastModified,
  }));
}
