import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getMatchPage, type MatchPage } from "@/lib/public/match-page";
import { youtubeId } from "@/lib/public/youtube";

export const dynamic = "force-dynamic";

function year(date: string): string { return date.slice(0, 4); }

function methodLabel(method: string, detail: string | null): string {
  if (method === "SUBMISSION") return detail ?? "Submission";
  if (method === "DECISION") return "Decision";
  if (method === "POINTS") return "Points";
  if (method === "OVERTIME") return "Overtime";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

function duration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const page = await getMatchPage(db, id);
  if (!page) return { title: "Not found — RollVault" };
  const names = page.competitors.map((c) => c.name).join(" vs ");
  const title = `${names} — ${page.event.name} — RollVault`;
  const description = `${names} at ${page.event.name} (${year(page.event.startDate)}): ${methodLabel(page.match.method, page.match.methodDetail)}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function MatchPublicPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const page = await getMatchPage(db, id);
  if (!page) notFound();
  const embedId = page.videos.length ? youtubeId(page.videos[0]!.url) : null;
  const facts = [
    page.match.weightClass,
    page.match.ruleset,
    page.match.round,
    duration(page.match.durationSeconds),
  ].filter(Boolean);
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow">
          <Link href={`/event/${page.event.slug}`}>{page.event.name}</Link>
          <span>·</span>
          <span>{year(page.event.startDate)}</span>
        </div>
        <h1 className="athlete-name">
          {page.competitors.map((c, i) => (
            <span key={c.id} className={c.outcome === "WON" ? "" : "loss"}>
              {i > 0 ? " vs " : ""}
              <Link href={`/athlete/${c.slug}`}>{c.name}</Link>
            </span>
          ))}
        </h1>
      </header>

      <section>
        <div className="section-head">Result</div>
        <p className={`method-focal ${page.match.method === "SUBMISSION" ? "method sub" : ""}`}>
          {methodLabel(page.match.method, page.match.methodDetail)}
        </p>
        {facts.length > 0 && <p className="empty">{facts.join(" · ")}</p>}
      </section>

      {embedId ? (
        <section>
          <div className="section-head">Watch</div>
          <div className="embed">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${embedId}`}
              title="Match video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {page.videos.length > 1 && (
            <div className="card-list" style={{ marginTop: "0.8rem" }}>
              {page.videos.slice(1).map((v, i) => (
                <a key={v.id} className="card" href={v.url} target="_blank" rel="noreferrer">
                  <span className="t">{v.title ?? `Additional angle ${i + 2}`}</span>
                  <span className="s">YouTube ↗</span>
                </a>
              ))}
            </div>
          )}
        </section>
      ) : page.videos.length ? (
        <section>
          <div className="section-head">Watch</div>
          <div className="card-list">
            {page.videos.map((v) => (
              <a key={v.id} className="card" href={v.url} target="_blank" rel="noreferrer">
                <span className="t">{v.title ?? "Match video"}</span>
                <span className="s">YouTube ↗</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <Sources page={page} />
    </main>
  );
}

function Sources({ page }: { page: MatchPage }) {
  const verifiedAt = page.match.verifiedAt;
  return (
    <div className="sources">
      Sources · {verifiedAt ? `last verified ${new Date(verifiedAt).toISOString().slice(0, 10)}` : "verification pending"}
    </div>
  );
}
