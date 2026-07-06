import { it, expect, vi } from "vitest";
import { createFetcher } from "./fetcher";

function res(body: string, status = 200): Response {
  return new Response(body, { status });
}

it("returns body text and sends the honest UA", async () => {
  const fetchImpl = vi.fn(async () => res("<html>ok</html>"));
  const fetchText = createFetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
  const body = await fetchText("https://www.bjjheroes.com/x");
  expect(body).toContain("ok");
  const init = fetchImpl.mock.calls[0]![1] as RequestInit;
  expect((init.headers as Record<string, string>)["User-Agent"]).toContain("RollVaultIngestBot");
});

it("retries on 5xx then succeeds", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(res("busy", 503))
    .mockResolvedValueOnce(res("<html>ok</html>", 200));
  const fetchText = createFetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, maxRetries: 3 });
  const body = await fetchText("https://www.bjjheroes.com/x");
  expect(body).toContain("ok");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("throws after exhausting retries", async () => {
  const fetchImpl = vi.fn(async () => res("nope", 500));
  const fetchText = createFetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, maxRetries: 2 });
  await expect(fetchText("https://www.bjjheroes.com/x")).rejects.toThrow();
});
