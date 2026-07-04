"use client";
import { useState } from "react";
import { AthletePicker } from "./athlete-picker";

const METHODS = ["SUBMISSION", "POINTS", "DECISION", "DQ", "OVERTIME", "FORFEIT", "NC", "DRAW"];
const TYPES = ["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"];

export function MatchForm({ eventId }: { eventId: string }) {
  const [matchType, setMatchType] = useState("SUPERFIGHT");
  const [method, setMethod] = useState("SUBMISSION");
  const [methodDetail, setMethodDetail] = useState("");
  const [weightClass, setWeightClass] = useState("");
  const [ruleset, setRuleset] = useState("");
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(null);
  const [loser, setLoser] = useState<{ id: string; name: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!winner || !loser) return;
    const res = await fetch("/api/admin/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId, matchType, method,
        methodDetail: methodDetail || undefined,
        weightClass: weightClass || undefined,
        ruleset: ruleset || undefined,
        competitors: [
          { athleteId: winner.id, outcome: "WON", slotOrder: 1 },
          { athleteId: loser.id, outcome: "LOST", slotOrder: 2 },
        ],
      }),
    });
    setResult(res.ok ? "Match added" : "Error");
  }

  return (
    <form onSubmit={submit}>
      <h3>Add match</h3>
      <label>Type
        <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label>Weight class
        <input value={weightClass} onChange={(e) => setWeightClass(e.target.value)} placeholder="-88kg / Absolute" />
      </label>
      <label>Ruleset
        <input value={ruleset} onChange={(e) => setRuleset(e.target.value)} placeholder="ADCC / EBI Overtime" />
      </label>
      <label>Method
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      {method === "SUBMISSION" && (
        <label>Submission
          <input value={methodDetail} onChange={(e) => setMethodDetail(e.target.value)} placeholder="RNC / heel hook" />
        </label>
      )}
      <p>Winner {winner ? `— ${winner.name}` : ""}</p>
      <AthletePicker label="Winner" onPick={setWinner} />
      <p>Loser {loser ? `— ${loser.name}` : ""}</p>
      <AthletePicker label="Loser" onPick={setLoser} />
      <button type="submit" disabled={!winner || !loser}>Add match</button>
      {result && <p>{result}</p>}
    </form>
  );
}
