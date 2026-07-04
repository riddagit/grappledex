"use client";
import { useState } from "react";

export function VideoForm({ matchId }: { matchId: string }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    const res = await fetch("/api/admin/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId, url, title: title || undefined }),
    });
    setResult(res.ok ? "Video added — reload to see it" : "Error");
    if (res.ok) { setUrl(""); setTitle(""); }
  }

  return (
    <form onSubmit={submit} style={{ margin: "4px 0 0 1rem" }}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="YouTube URL"
        style={{ minWidth: 240 }}
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="title (optional)"
      />
      <button type="submit" disabled={!url}>Add video</button>
      {result && <span> {result}</span>}
    </form>
  );
}
