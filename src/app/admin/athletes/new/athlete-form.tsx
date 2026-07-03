"use client";
import { useState } from "react";

type Dup = { id: string; name: string; score: number };

export function AthleteForm() {
  const [fullName, setFullName] = useState("");
  const [dups, setDups] = useState<Dup[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function checkDuplicates() {
    if (!fullName) return;
    const res = await fetch(
      `/api/admin/athletes/duplicates?name=${encodeURIComponent(fullName)}`,
    );
    const found: Dup[] = await res.json();
    setDups(found);
    setAcknowledged(found.length === 0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName || !acknowledged) return;
    const res = await fetch("/api/admin/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName }),
    });
    setResult(res.ok ? "Created" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <label>
        Full name
        <input
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setAcknowledged(false);
            setDups([]);
          }}
          onBlur={checkDuplicates}
        />
      </label>

      {dups.length > 0 && (
        <div style={{ border: "1px solid #c00", padding: 8, margin: "8px 0" }}>
          <strong>Possible duplicates:</strong>
          <ul>
            {dups.map((d) => (
              <li key={d.id}>{d.name} ({d.score.toFixed(2)})</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            This is a new, distinct athlete
          </label>
        </div>
      )}

      <button type="submit" disabled={!fullName || !acknowledged}>
        Create
      </button>
      {result && <p>{result}</p>}
    </form>
  );
}
