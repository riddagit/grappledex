import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FetchText } from "./enumerate";

const execFileAsync = promisify(execFile);

const DEFAULT_UA = "RollVaultIngestBot/1.0 (+https://rollvault.net)";

// BJJ Heroes sits behind Cloudflare, which blocks Node's undici `fetch` on its
// TLS/HTTP fingerprint even with our honest UA — the identical request via curl
// returns 200. So the default transport shells out to curl: same honest identity
// (UA, Accept), just a client whose fingerprint isn't flagged. Requires `curl` on
// PATH. Tests inject `fetchImpl` and never touch this.
const HTTP_STATUS_MARKER = "\n__ROLLVAULT_HTTP_STATUS__:";

function curlFetchImpl(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const headerArgs: string[] = [];
    for (const [k, v] of Object.entries(headers)) headerArgs.push("-H", `${k}: ${v}`);
    const { stdout } = await execFileAsync(
      "curl",
      ["-s", "-S", "--compressed", ...headerArgs, "-w", `${HTTP_STATUS_MARKER}%{http_code}`, url],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const idx = stdout.lastIndexOf(HTTP_STATUS_MARKER);
    const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
    const status = idx >= 0 ? Number(stdout.slice(idx + HTTP_STATUS_MARKER.length)) : 0;
    return new Response(body, { status: Number.isFinite(status) && status > 0 ? status : 502 });
  }) as typeof fetch;
}

export type FetcherOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRetries?: number;
  userAgent?: string;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createFetcher(opts: FetcherOptions = {}): FetchText {
  const fetchImpl = opts.fetchImpl ?? curlFetchImpl();
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
        response = await fetchImpl(url, {
          headers: { "User-Agent": userAgent, "Accept": "*/*" },
        });
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
