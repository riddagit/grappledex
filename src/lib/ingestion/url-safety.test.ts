import { describe, it, expect } from "vitest";
import { assertSafeUrl } from "./url-safety";

describe("assertSafeUrl", () => {
  it("accepts a normal public http(s) URL and returns a URL", () => {
    const url = assertSafeUrl("https://en.wikipedia.org/wiki/ADCC");
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe("en.wikipedia.org");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertSafeUrl("ftp://example.com/x")).toThrow(/scheme/i);
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(/scheme/i);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertSafeUrl("not a url")).toThrow(/invalid url/i);
  });

  it("rejects loopback and localhost", () => {
    expect(() => assertSafeUrl("http://localhost/x")).toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1/x")).toThrow();
    expect(() => assertSafeUrl("http://[::1]/x")).toThrow();
  });

  it("rejects private and link-local IPv4 ranges", () => {
    expect(() => assertSafeUrl("http://10.0.0.5/x")).toThrow();
    expect(() => assertSafeUrl("http://172.16.4.4/x")).toThrow();
    expect(() => assertSafeUrl("http://192.168.1.1/x")).toThrow();
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data")).toThrow();
  });
});
