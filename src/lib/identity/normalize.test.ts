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
  it("transliterates non-decomposing latin letters", () => {
    expect(normalizeName("Łukasz Nowak")).toBe("lukasz nowak");
    expect(normalizeName("Đorđe")).toBe("dorde");
    expect(normalizeName("Søren Østergård")).toBe("soren ostergard");
    expect(normalizeName("Straße")).toBe("strasse");
  });
});

describe("slugify", () => {
  it("produces a url-safe slug", () => {
    expect(slugify("André Galvão")).toBe("andre-galvao");
    expect(slugify("Gordon Ryan")).toBe("gordon-ryan");
    expect(slugify("Łukasz Nowak")).toBe("lukasz-nowak");
  });
  it("returns empty string when no latin content remains", () => {
    expect(slugify("山田太郎")).toBe("");
    expect(slugify("Ivan")).toBe("ivan");
  });
});
