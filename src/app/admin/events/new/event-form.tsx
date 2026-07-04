"use client";
import { useState } from "react";

type Promotion = { id: string; name: string; slug: string };

export function EventForm() {
  const [promoQuery, setPromoQuery] = useState("");
  const [promoResults, setPromoResults] = useState<Promotion[]>([]);
  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function searchPromos(q: string) {
    setPromoQuery(q);
    setPromotionId(null);
    if (!q) { setPromoResults([]); return; }
    const res = await fetch(`/api/admin/promotions?q=${encodeURIComponent(q)}`);
    setPromoResults(await res.json());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!promotionId) return;
    const res = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promotionId, name, startDate }),
    });
    setResult(res.ok ? "Created" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <label>Promotion
        <input
          value={promoQuery}
          onChange={(e) => searchPromos(e.target.value)}
          placeholder="Search promotions…"
        />
      </label>
      {promoResults.length > 0 && !promotionId && (
        <ul>
          {promoResults.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { setPromotionId(p.id); setPromoQuery(p.name); setPromoResults([]); }}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>Event name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Start date
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <button type="submit" disabled={!promotionId || !name || !startDate}>Create</button>
      {result && <p>{result}</p>}
    </form>
  );
}
