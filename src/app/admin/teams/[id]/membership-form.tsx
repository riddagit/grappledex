"use client";
import { useState } from "react";
import { AthletePicker } from "@/app/admin/events/[id]/athlete-picker";

export function MembershipForm({ teamId }: { teamId: string }) {
  const [athlete, setAthlete] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState("competitor");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete) return;
    const res = await fetch("/api/admin/memberships", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId,
        athleteId: athlete.id,
        role: role || undefined,
        startDate,
        endDate: endDate || undefined,
      }),
    });
    setResult(res.ok ? "Member added — reload to see roster" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <h3>Add member</h3>
      <p>Athlete {athlete ? `— ${athlete.name}` : ""}</p>
      <AthletePicker label="Athlete" onPick={setAthlete} />
      <label>Role
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="competitor / coach" />
      </label>
      <label>Start date
        <input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="YYYY-MM-DD" />
      </label>
      <label>End date (blank = current)
        <input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="YYYY-MM-DD" />
      </label>
      <button type="submit" disabled={!athlete || !startDate}>Add member</button>
      {result && <p>{result}</p>}
    </form>
  );
}
