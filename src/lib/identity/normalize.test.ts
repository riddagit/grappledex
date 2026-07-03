import { describe, it, expect } from "vitest";
import { normalizeName, slugify } from "@/lib/identity/normalize";

describe("normalizeName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeName("  Gordon   Ryan ")).toBe("gordon ryan");
  });
  it("strips diacritics and punctuation", () => {
    expect(normalizeName("André Galvão")).toBe("andre galvao");
    expect(normalizeName("Gordon 'The King' Ryan")).toBe("gordon the king ryan");
  });
});

describe("slugify", () => {
  it("produces a url-safe slug", () => {
    expect(slugify("André Galvão")).toBe("andre-galvao");
    expect(slugify("Gordon Ryan")).toBe("gordon-ryan");
  });
});
