import { describe, it, expect } from "vitest";
import { classifyFormat, classifyMatchType, classifyMethod } from "./classify";

describe("classifyFormat", () => {
  it("tags known no-gi promotions", () => {
    expect(classifyFormat("ADCC 2022 World Championship")).toBe("nogi");
    expect(classifyFormat("Who's Number One")).toBe("nogi");
    expect(classifyFormat("Polaris 21")).toBe("nogi");
  });
  it("tags known gi promotions", () => {
    expect(classifyFormat("IBJJF World Championship")).toBe("gi");
    expect(classifyFormat("IBJJF Pans")).toBe("gi");
  });
  it("returns unknown for unrecognised competitions", () => {
    expect(classifyFormat("Studio 540 SPF")).toBe("unknown");
  });
});

describe("classifyMatchType", () => {
  it("maps superfight stages", () => {
    expect(classifyMatchType("SPF")).toEqual({ matchType: "SUPERFIGHT", round: null });
  });
  it("maps bracket stages to a readable round", () => {
    expect(classifyMatchType("F")).toEqual({ matchType: "BRACKET", round: "Final" });
    expect(classifyMatchType("SF")).toEqual({ matchType: "BRACKET", round: "Semifinal" });
  });
  it("defaults to bracket with null round when unknown", () => {
    expect(classifyMatchType(null)).toEqual({ matchType: "BRACKET", round: null });
  });
});

describe("classifyMethod", () => {
  it("maps points and decisions", () => {
    expect(classifyMethod("Points")).toEqual({ method: "POINTS", methodDetail: null });
    expect(classifyMethod("Referee Decision")).toEqual({ method: "DECISION", methodDetail: null });
    expect(classifyMethod("Pts: 2x0")).toEqual({ method: "POINTS", methodDetail: "Pts: 2x0" });
  });
  it("treats named techniques as submissions with detail", () => {
    expect(classifyMethod("RNC")).toEqual({ method: "SUBMISSION", methodDetail: "RNC" });
    expect(classifyMethod("Armbar")).toEqual({ method: "SUBMISSION", methodDetail: "Armbar" });
  });
});
