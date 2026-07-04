import { describe, it, expect } from "vitest";
import { AddVideoSchema } from "@/app/api/admin/videos/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("AddVideoSchema", () => {
  it("accepts a valid video", () => {
    const parsed = AddVideoSchema.parse({
      matchId: uuid, url: "https://youtu.be/abc", title: "Final",
    });
    expect(parsed.url).toBe("https://youtu.be/abc");
  });
  it("rejects a non-uuid matchId", () => {
    expect(() =>
      AddVideoSchema.parse({ matchId: "nope", url: "https://youtu.be/abc" }),
    ).toThrow();
  });
  it("rejects a malformed url", () => {
    expect(() =>
      AddVideoSchema.parse({ matchId: uuid, url: "not-a-url" }),
    ).toThrow();
  });
});
