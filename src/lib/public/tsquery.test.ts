import { describe, it, expect } from "vitest";
import { toPrefixTsquery } from "@/lib/public/tsquery";

describe("toPrefixTsquery", () => {
  it("lowercases, splits, and prefixes each token", () => {
    expect(toPrefixTsquery("Gordon Ryan")).toBe("gordon:* & ryan:*");
    expect(toPrefixTsquery("gord")).toBe("gord:*");
  });
  it("returns null for empty / whitespace / punctuation-only input", () => {
    expect(toPrefixTsquery("")).toBeNull();
    expect(toPrefixTsquery("   ")).toBeNull();
    expect(toPrefixTsquery("&|!()")).toBeNull();
  });
  it("is injection-safe: only sanitised token:* terms survive", () => {
    expect(toPrefixTsquery("a & b | c ():!*")).toBe("a:* & b:* & c:*");
  });
});
