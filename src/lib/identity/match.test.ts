import { describe, it, expect } from "vitest";
import { nameSimilarity, findDuplicateCandidates } from "@/lib/identity/match";

describe("nameSimilarity", () => {
  it("is 1 for identical normalized names", () => {
    expect(nameSimilarity("Gordon Ryan", "gordon  ryan")).toBe(1);
  });
  it("is high for a near match", () => {
    expect(nameSimilarity("Gordon Ryan", "Gordon Ryann")).toBeGreaterThan(0.9);
  });
  it("is low for unrelated names", () => {
    expect(nameSimilarity("Gordon Ryan", "Nicky Rodriguez")).toBeLessThan(0.5);
  });
});

describe("findDuplicateCandidates", () => {
  const candidates = [
    { id: "1", name: "Gordon Ryan", aliases: ["The King"] },
    { id: "2", name: "Nicky Rodriguez", aliases: ["Nicky Rod"] },
  ];

  it("matches on the canonical name", () => {
    const hits = findDuplicateCandidates("gordon ryann", candidates);
    expect(hits[0]?.id).toBe("1");
    expect(hits).toHaveLength(1);
  });

  it("matches on an alias", () => {
    const hits = findDuplicateCandidates("Nicky Rod", candidates);
    expect(hits[0]?.id).toBe("2");
  });

  it("returns empty when nothing clears the threshold", () => {
    expect(findDuplicateCandidates("Roger Gracie", candidates)).toEqual([]);
  });
});
