import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ReadableResult {
  text: string;
  title?: string;
}

/**
 * Pure HTML → readable text. Mozilla Readability isolates the main article body
 * (dropping nav/ads/footer); when it finds no article we fall back to the plain
 * body text. No network — unit-testable with HTML strings.
 */
export function extractReadable(html: string, baseUrl: string): ReadableResult {
  // Readability mutates its document, so parse it on a dedicated DOM.
  const dom = new JSDOM(html, { url: baseUrl });
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent && article.textContent.trim()) {
    return {
      text: normalizeWhitespace(article.textContent),
      title: article.title?.trim() || undefined,
    };
  }
  // Fallback on a fresh DOM (the one above was mutated by Readability).
  const doc = new JSDOM(html).window.document;
  return {
    text: normalizeWhitespace(doc.body?.textContent ?? ""),
    title: doc.title?.trim() || undefined,
  };
}

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
