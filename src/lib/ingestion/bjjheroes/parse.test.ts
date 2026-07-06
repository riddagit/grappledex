import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseProfile, type BjjHeroesProfile } from "./parse";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "__fixtures__/gordon-ryan.html"), "utf8");

let profile: BjjHeroesProfile;
beforeAll(() => {
  profile = parseProfile(html, "https://www.bjjheroes.com/bjj-fighters/gordon-ryan");
});

it("extracts identity from the profile", () => {
  expect(profile.slug).toBe("gordon-ryan");
  expect(profile.fullName).toBe("Gordon Ryan");
  expect(profile.formalName).toContain("Gordon");
});

it("extracts a non-empty record with well-formed rows", () => {
  expect(profile.records.length).toBeGreaterThan(10);
  const r = profile.records[0]!;
  expect(r.bjjHeroesId).toMatch(/^\d+$/);
  expect(r.opponentName.length).toBeGreaterThan(0);
  expect(["WON", "LOST", "DRAW"]).toContain(r.outcome);
  expect(r.year).toBeGreaterThan(1990);
  expect(r.year).toBeLessThan(2100);
});

it("cleans doubled opponent names from the sort span", () => {
  // Cell markup is `<span>Name</span><a>Name</a>`; the name must not be doubled.
  const first = profile.records[0]!;
  expect(first.opponentName).not.toMatch(/(.+)\1/);
});

it("dedups nothing itself but yields unique record IDs", () => {
  const ids = profile.records.map((r) => r.bjjHeroesId);
  expect(new Set(ids).size).toBe(ids.length);
});
