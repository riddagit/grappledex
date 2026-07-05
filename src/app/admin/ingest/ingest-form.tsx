"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function IngestForm() {
  const router = useRouter();
  const [sourceText, setSourceText] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceText.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceText, sourceNote: sourceNote || undefined }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data?.batch?.error ?? "Extraction failed");
      return;
    }
    router.push(`/admin/ingest/${data.batch.id}`);
  }

  return (
    <form onSubmit={submit}>
      <label style={{ display: "block", margin: "8px 0" }}>
        Source note (optional)
        <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        Pasted text
        <textarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          rows={16}
          style={{ width: "100%" }}
        />
      </label>
      <button type="submit" disabled={busy || !sourceText.trim()}>
        {busy ? "Extracting…" : "Extract"}
      </button>
      {error && <p style={{ color: "#c00" }}>{error}</p>}
    </form>
  );
}
