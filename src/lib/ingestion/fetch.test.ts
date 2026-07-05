import { describe, it, expect } from "vitest";
import { FakePageFetcher, HttpPageFetcher, fetchUrl, type FetchDeps } from "./fetch";

function stubFetch(res: Response): FetchDeps {
  return { fetch: async () => res };
}

const htmlHeaders = { "content-type": "text/html; charset=utf-8" };

describe("FakePageFetcher", () => {
  it("returns its preset result and satisfies PageFetcher", async () => {
    const f = new FakePageFetcher({ text: "hello", title: "T" });
    expect(await f.fetch("https://ignored.example")).toEqual({ text: "hello", title: "T" });
  });
});

describe("fetchUrl", () => {
  it("returns the HTML body for a good HTML response", async () => {
    const res = new Response("<html><body>ok</body></html>", { headers: htmlHeaders });
    const html = await fetchUrl("https://example.com/a", stubFetch(res));
    expect(html).toContain("<body>ok</body>");
  });

  it("rejects a non-HTML content-type", async () => {
    const res = new Response("{}", { headers: { "content-type": "application/json" } });
    await expect(fetchUrl("https://example.com/a", stubFetch(res))).rejects.toThrow(/content-type/i);
  });

  it("rejects a response larger than the cap via content-length", async () => {
    const res = new Response("x", {
      headers: { ...htmlHeaders, "content-length": String(6 * 1024 * 1024) },
    });
    await expect(fetchUrl("https://example.com/a", stubFetch(res))).rejects.toThrow(/too large/i);
  });

  it("rejects a non-2xx response", async () => {
    const res = new Response("nope", { status: 404, statusText: "Not Found", headers: htmlHeaders });
    await expect(fetchUrl("https://example.com/a", stubFetch(res))).rejects.toThrow(/404/);
  });

  it("applies the SSRF guard before fetching", async () => {
    let called = false;
    const deps: FetchDeps = { fetch: async () => { called = true; return new Response(""); } };
    await expect(fetchUrl("http://127.0.0.1/x", deps)).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe("HttpPageFetcher", () => {
  it("fetches then extracts readable text", async () => {
    const body = "Gordon Ryan won ADCC 2022 in dominant fashion. ".repeat(15);
    const res = new Response(
      `<html><head><title>Recap</title></head><body><article><p>${body}</p></article></body></html>`,
      { headers: htmlHeaders },
    );
    const f = new HttpPageFetcher(stubFetch(res));
    const { text } = await f.fetch("https://example.com/recap");
    expect(text).toContain("Gordon Ryan won ADCC 2022");
  });
});
