"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResults } from "@/lib/public/search";

const ORDER: (keyof SearchResults)[] = ["athletes", "events", "teams", "promotions"];
const LABEL: Record<keyof SearchResults, string> = {
  athletes: "Athlete", events: "Event", teams: "Team", promotions: "Promotion",
};

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data: SearchResults) => { setResults(data); setOpen(true); })
        .catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const hasHits = results
    ? ORDER.some((k) => results[k].length > 0)
    : false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  }

  return (
    <form ref={boxRef} className="search-box" role="search" action="/search" onSubmit={submit}>
      <input
        name="q" value={q} onChange={(e) => setQ(e.target.value)}
        onFocus={() => hasHits && setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        placeholder="Search athletes, events, teams…" autoComplete="off" aria-label="Search"
      />
      {open && results && hasHits && (
        <div className="search-dropdown" role="listbox">
          {ORDER.filter((k) => results[k].length > 0).map((k) => (
            <div key={k} className="sd-group">
              <div className="sd-label">{LABEL[k]}</div>
              {results[k].map((h) => (
                <button
                  type="button" key={h.id} className="sd-row" role="option"
                  onClick={() => { router.push(h.path); setOpen(false); }}
                >
                  <span className="sd-title">{h.title}</span>
                  {h.subtitle ? <span className="sd-sub">{h.subtitle}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
