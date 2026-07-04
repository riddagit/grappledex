"use client";
import { useState } from "react";

export function TeamForm() {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, shortName: shortName || undefined }),
    });
    if (res.ok) {
      const team = await res.json();
      setResult(`Created — manage roster at /admin/teams/${team.id}`);
    } else {
      setResult("Error");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Short name
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} />
      </label>
      <button type="submit" disabled={!name}>Create</button>
      {result && <p>{result}</p>}
    </form>
  );
}
