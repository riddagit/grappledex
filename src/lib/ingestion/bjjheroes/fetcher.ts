import type { FetchText } from "./enumerate";

const DEFAULT_UA = "RollVaultIngestBot/1.0 (+https://rollvault.net)";

export type FetcherOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRetries?: number;
  userAgent?: string;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createFetcher(opts: FetcherOptions = {}): FetchText {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? wait;
  const minIntervalMs = opts.minIntervalMs ?? 1500;
  const maxRetries = opts.maxRetries ?? 3;
  const userAgent = opts.userAgent ?? DEFAULT_UA;

  let lastAt = 0;

  return async function fetchText(url: string): Promise<string> {
    let attempt = 0;
    // Single-threaded pacing: keep at least minIntervalMs between requests.
    const since = Date.now() - lastAt;
    if (since < minIntervalMs) await sleep(minIntervalMs - since);

    while (true) {
      attempt += 1;
      lastAt = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { "User-Agent": userAgent } });
      } catch (err) {
        if (attempt > maxRetries) throw err;
        await sleep(minIntervalMs * attempt);
        continue;
      }
      if (response.ok) return response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt > maxRetries) {
        throw new Error(`fetch ${url} failed: HTTP ${response.status}`);
      }
      await sleep(minIntervalMs * attempt); // linear backoff
    }
  };
}
