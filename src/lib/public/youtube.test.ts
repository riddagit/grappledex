import { describe, it, expect } from "vitest";
import { youtubeId } from "@/lib/public/youtube";

describe("youtubeId", () => {
  it("parses watch, short and embed urls", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=abc123XYZ_-")).toBe("abc123XYZ_-");
    expect(youtubeId("https://youtu.be/abc123XYZ_-")).toBe("abc123XYZ_-");
    expect(youtubeId("https://www.youtube-nocookie.com/embed/abc123XYZ_-")).toBe("abc123XYZ_-");
  });
  it("returns null for non-youtube urls", () => {
    expect(youtubeId("https://example.com/video")).toBeNull();
  });
});
