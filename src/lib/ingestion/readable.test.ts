import { describe, it, expect } from "vitest";
import { extractReadable } from "./readable";

// A realistically-sized article so Readability engages (its char threshold is ~500).
const body = "Gordon Ryan submitted every opponent on his way to gold at ADCC 2022. ".repeat(12);
const articleHtml = `<!DOCTYPE html><html><head><title>ADCC 2022 Recap</title></head>
<body>
  <nav>HOME ABOUT CONTACT SUBSCRIBE NEWSLETTER</nav>
  <article><h1>ADCC 2022 Recap</h1><p>${body}</p></article>
  <footer>Copyright 2022 SomeSite. All rights reserved. Privacy policy.</footer>
</body></html>`;

describe("extractReadable", () => {
  it("returns the main article body and title, dropping nav/footer boilerplate", () => {
    const { text, title } = extractReadable(articleHtml, "https://example.com/adcc");
    expect(text).toContain("Gordon Ryan submitted every opponent");
    expect(text).not.toContain("SUBSCRIBE");
    expect(text).not.toContain("Privacy policy");
    expect(title).toMatch(/ADCC 2022 Recap/);
  });

  it("falls back to body text when there is no article-worthy content", () => {
    const { text } = extractReadable(
      "<html><head><title>Tiny</title></head><body><p>just a stub</p></body></html>",
      "https://example.com",
    );
    expect(text).toContain("just a stub");
  });
});
