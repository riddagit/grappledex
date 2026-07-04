import { describe, it, expect, afterEach } from "vitest";
import { siteUrl } from "@/lib/public/site-url";

const original = process.env.NEXT_PUBLIC_SITE_URL;
afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original; });

describe("siteUrl", () => {
  it("joins origin and path without double slashes", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/";
    expect(siteUrl("/athlete/gordon-ryan")).toBe("https://example.com/athlete/gordon-ryan");
    expect(siteUrl("sitemap.xml")).toBe("https://example.com/sitemap.xml");
  });

  it("honours the env override and falls back to the placeholder", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://grappledex.test";
    expect(siteUrl("/")).toBe("https://grappledex.test/");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteUrl("/")).toBe("https://grappledex.com/");
  });
});
