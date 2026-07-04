"use client";
import { useState } from "react";

type Athlete = { id: string; fullName: string; slug: string };
type Dup = { id: string; name: string; score: number };

export function AthletePicker(
  { label, onPick }: { label: string; onPick: (a: { id: string; name: string }) => void },
) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Athlete[]>([]);
  const [dups, setDups] = useState<Dup[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (!q) { setResults([]); return; }
    const res = await fetch(`/api/admin/athletes?q=${encodeURIComponent(q)}`);
    setResults(await res.json());
  }

  async function checkDuplicates() {
    if (!query) return;
    const res = await fetch(`/api/admin/athletes/duplicates?name=${encodeURIComponent(query)}`);
    const found: Dup[] = await res.json();
    setDups(found);
    setAcknowledged(found.length === 0);
  }

  async function createNew() {
    const res = await fetch("/api/admin/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: query }),
    });
    if (res.ok) {
      const a = await res.json();
      onPick({ id: a.id, name: a.fullName });
      setResults([]); setDups([]);
    }
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 8, margin: "4px 0" }}>
      <label>{label}
        <input value={query} onChange={(e) => search(e.target.value)} onBlur={checkDuplicates} />
      </label>
      {results.length > 0 && (
        <ul>
          {results.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => { onPick({ id: a.id, name: a.fullName }); setResults([]); setQuery(a.fullName); }}>
                {a.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dups.length > 0 && (
        <div style={{ border: "1px solid #c00", padding: 8 }}>
          <strong>Possible duplicates:</strong>
          <ul>{dups.map((d) => <li key={d.id}>{d.name} ({d.score.toFixed(2)})</li>)}</ul>
          <label>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            This is a new, distinct athlete
          </label>
        </div>
      )}
      <button type="button" disabled={!query || !acknowledged} onClick={createNew}>
        Create &amp; use “{query}”
      </button>
    </div>
  );
}
