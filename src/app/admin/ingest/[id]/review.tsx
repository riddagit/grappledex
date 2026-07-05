"use client";
import { useState } from "react";

type Candidate = {
  id: string;
  entityType: string;
  localRef: string;
  payload: unknown;
  resolvedEntityId: string | null;
  matchScore: number | null;
  decision: string;
  committedEntityId: string | null;
};

export function ReviewQueue(
  { batchId, candidates, committed }: { batchId: string; candidates: Candidate[]; committed: boolean },
) {
  const [rows, setRows] = useState(candidates);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(candidateId: string, decision: string) {
    await fetch(`/api/admin/ingest/${batchId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId, decision }),
    });
    setRows((rs) => rs.map((r) => (r.id === candidateId ? { ...r, decision } : r)));
  }

  async function commit() {
    const res = await fetch(`/api/admin/ingest/${batchId}/commit`, { method: "POST" });
    const data = await res.json();
    setMessage(res.ok
      ? `Committed: ${data.promotions} promotions, ${data.events} events, ${data.athletes} athletes, ${data.matches} matches (as drafts).`
      : `Commit failed: ${data.error}`);
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th align="left">Type</th><th align="left">Summary</th><th align="left">Resolved?</th><th align="left">Decision</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #ddd" }}>
              <td>{r.entityType}</td>
              <td><code>{JSON.stringify(r.payload)}</code></td>
              <td>{r.resolvedEntityId ? `yes (${r.matchScore?.toFixed(2) ?? ""})` : "—"}</td>
              <td>
                {committed ? r.decision : (
                  <>
                    {(["accept", "merge", "reject"] as const).map((d) => (
                      <button
                        key={d}
                        disabled={d === "merge" && !r.resolvedEntityId}
                        onClick={() => decide(r.id, d)}
                        style={{ fontWeight: r.decision === d ? "bold" : "normal", marginRight: 4 }}
                      >
                        {d}
                      </button>
                    ))}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!committed && <button onClick={commit} style={{ marginTop: 12 }}>Commit batch</button>}
      {message && <p>{message}</p>}
    </div>
  );
}
