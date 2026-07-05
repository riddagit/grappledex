import { assertSafeUrl } from "./url-safety";
import { extractReadable, type ReadableResult } from "./readable";

export interface PageFetcher {
  fetch(url: string): Promise<ReadableResult>;
}

/** Test double: returns a preset result, ignoring the URL. Mirrors FakeExtractor. */
export class FakePageFetcher implements PageFetcher {
  constructor(private readonly result: ReadableResult) {}
  async fetch(): Promise<ReadableResult> {
    return this.result;
  }
}

export interface FetchDeps {
  fetch: typeof fetch;
}

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "RollVaultIngestBot/1.0 (+https://rollvault.net)";

/**
 * Network fetch with SSRF guard, timeout, size cap, and content-type check.
 * Returns the raw HTML string. `fetch` is injectable for tests.
 */
export async function fetchUrl(rawUrl: string, deps: FetchDeps = { fetch }): Promise<string> {
  const url = assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await deps.fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unexpected content-type: ${contentType || "(none)"}`);
  }
  return readCapped(res, MAX_BYTES);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new Error(`Response too large: ${declared} bytes`);
  }
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Response too large");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response too large (> ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Real fetcher: guarded network fetch → Readability extraction. */
export class HttpPageFetcher implements PageFetcher {
  constructor(private readonly deps: FetchDeps = { fetch }) {}
  async fetch(url: string): Promise<ReadableResult> {
    const html = await fetchUrl(url, this.deps);
    return extractReadable(html, url);
  }
}
