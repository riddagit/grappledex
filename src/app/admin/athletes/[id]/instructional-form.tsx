"use client";
import { useState } from "react";

export function InstructionalForm({ athleteId }: { athleteId: string }) {
  const [title, setTitle] = useState("");
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !affiliateUrl) return;
    const res = await fetch("/api/admin/instructionals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        athleteId,
        title,
        affiliateUrl,
        thumbnailUrl: thumbnailUrl || undefined,
      }),
    });
    setResult(res.ok ? "Instructional added — reload to see it" : "Error");
    if (res.ok) { setTitle(""); setAffiliateUrl(""); setThumbnailUrl(""); }
  }

  return (
    <form onSubmit={submit}>
      <h3>Add instructional</h3>
      <label>Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Systematically Attacking…" />
      </label>
      <label>Affiliate URL
        <input value={affiliateUrl} onChange={(e) => setAffiliateUrl(e.target.value)} placeholder="https://bjjfanatics.com/products/…" />
      </label>
      <label>Thumbnail URL (optional)
        <input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} placeholder="https://…" />
      </label>
      <button type="submit" disabled={!title || !affiliateUrl}>Add instructional</button>
      {result && <p>{result}</p>}
    </form>
  );
}
