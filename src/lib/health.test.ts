import { describe, it, expect } from "vitest";
import { ping } from "@/lib/health";

describe("ping", () => {
  it("returns pong", () => {
    expect(ping()).toBe("pong");
  });
});
