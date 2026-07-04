"use client";
import { useState } from "react";
import { AthletePicker } from "./athlete-picker";

export function PlacementForm({ eventId }: { eventId: string }) {
  const [athlete, setAthlete] = useState<{ id: string; name: string } | null>(null);
  const [division, setDivision] = useState("");
  const [place, setPlace] = useState(1);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete) return;
    const res = await fetch("/api/admin/placements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId, athleteId: athlete.id, division, place }),
    });
    setResult(res.ok ? "Placement added" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <h3>Add placement</h3>
      <p>Athlete {athlete ? `— ${athlete.name}` : ""}</p>
      <AthletePicker label="Athlete" onPick={setAthlete} />
      <label>Division
        <input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="-88kg / Absolute" />
      </label>
      <label>Place
        <select value={place} onChange={(e) => setPlace(Number(e.target.value))}>
          <option value={1}>1 — Gold</option>
          <option value={2}>2 — Silver</option>
          <option value={3}>3 — Bronze</option>
        </select>
      </label>
      <button type="submit" disabled={!athlete || !division}>Add placement</button>
      {result && <p>{result}</p>}
    </form>
  );
}
