"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "text" | "url";

export function IngestForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = mode === "text" ? sourceText.trim().length > 0 : sourceUrl.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const payload =
      mode === "text"
        ? { sourceText, sourceNote: sourceNote || undefined }
        : { sourceUrl: sourceUrl.trim(), sourceNote: sourceNote || undefined };
    const res = await fetch("/api/admin/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.toString?.() ?? data?.batch?.error ?? "Extraction failed");
      return;
    }
    router.push(`/admin/ingest/${data.batch.id}`);
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: "flex", gap: 16, margin: "8px 0" }}>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "text"}
            onChange={() => setMode("text")}
          />{" "}
          Paste text
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "url"}
            onChange={() => setMode("url")}
          />{" "}
          Fetch URL
        </label>
      </div>

      <label style={{ display: "block", margin: "8px 0" }}>
        Source note (optional)
        <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} style={{ width: "100%" }} />
      </label>

      {mode === "text" ? (
        <label style={{ display: "block", margin: "8px 0" }}>
          Pasted text
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={16}
            style={{ width: "100%" }}
          />
        </label>
      ) : (
        <label style={{ display: "block", margin: "8px 0" }}>
          Source URL
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            style={{ width: "100%" }}
          />
        </label>
      )}

      <button type="submit" disabled={busy || !ready}>
        {busy ? (mode === "url" ? "Fetching…" : "Extracting…") : "Extract"}
      </button>
      {error && <p style={{ color: "#c00" }}>{error}</p>}
    </form>
  );
}
