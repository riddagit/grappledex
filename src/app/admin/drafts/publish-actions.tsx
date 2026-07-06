"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Summary = { athleteId: string; fullName: string; slug: string; publishableMatches: number };

async function post(body: unknown): Promise<string> {
  const res = await fetch("/api/admin/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return `Failed: ${JSON.stringify(data.error)}`;
  return `Published ${data.matches} matches, ${data.events} events, ${data.promotions} promotions, ${data.athletes} athletes (skipped ${data.skippedBlocked} blocked).`;
}

export function PublishActions(
  { publishableMatches, summaries }: { publishableMatches: number; summaries: Summary[] },
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(body: unknown) {
    setBusy(true);
    setMessage(await post(body));
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button disabled={busy || publishableMatches === 0} onClick={() => run({ scope: "all" })}>
        Publish all {publishableMatches} publishable matches
      </button>
      {message && <p>{message}</p>}
      <h2>Draft athletes</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th align="left">Athlete</th><th align="left">Publishable matches</th><th /></tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.athleteId} style={{ borderTop: "1px solid #ddd" }}>
              <td>{s.fullName}</td>
              <td>{s.publishableMatches}</td>
              <td>
                <button
                  disabled={busy}
                  onClick={() => run({ scope: "athlete", athleteId: s.athleteId })}
                >
                  Publish graph
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
