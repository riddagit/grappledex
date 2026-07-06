import { it, expect } from "vitest";
import { chunk } from "./chunk";

it("splits into size-N chunks with a remainder", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});
it("returns empty for empty input", () => {
  expect(chunk([], 3)).toEqual([]);
});
it("returns a single chunk when size >= length", () => {
  expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
});
it("throws on a non-positive size", () => {
  expect(() => chunk([1], 0)).toThrow();
});
