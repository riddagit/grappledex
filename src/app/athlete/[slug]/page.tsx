import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getAthletePage, type AthletePage } from "@/lib/public/athlete-page";

export const dynamic = "force-dynamic";

const RESULT_LABEL: Record<string, string> = {
  WON: "W", LOST: "L", DRAW: "D", NC: "NC", DQ: "DQ",
};
const RESULT_CLASS: Record<string, string> = {
  WON: "w", LOST: "l", DRAW: "d", NC: "d", DQ: "d",
};

function year(date: string): string {
  return date.slice(0, 4);
}

function methodLabel(method: string, detail: string | null): string {
  if (method === "SUBMISSION") return detail ?? "Submission";
  if (method === "DECISION") return "Decision";
  if (method === "POINTS") return "Points";
  if (method === "OVERTIME") return "Overtime";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getAthletePage(db, slug);
  if (!page) return { title: "Not found — Grappledex" };
  const { athlete, record } = page;
  return {
    title: `${athlete.fullName} — record, matches & finishes — Grappledex`,
    description: `${athlete.fullName}: ${record.wins}–${record.losses} in professional no-gi grappling, with full match history and submission breakdown.`,
  };
}

export default async function AthletePublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getAthletePage(db, slug);
  if (!page) notFound();

  return (
    <main className="wrap">
      <PersonJsonLd page={page} />
      <Header page={page} />
      <Record page={page} />
      <FinishSignature page={page} />
      <History page={page} />
      <Medals page={page} />
      <TeamTimeline page={page} />
      <Videos page={page} />
      <Instructionals page={page} />
      <Sources page={page} />
    </main>
  );
}

function Header({ page }: { page: AthletePage }) {
  const current = page.teamTimeline.find((t) => t.endDate === null);
  const identity = (
    <div>
      <div className="eyebrow">
        <span>{page.athlete.nationality ?? "—"}</span>
        {current && (
          <>
            <span>·</span>
            <Link href={`/team/${current.teamSlug}`}>{current.teamName}</Link>
          </>
        )}
      </div>
      <h1 className="athlete-name">{page.athlete.fullName}</h1>
    </div>
  );
  // Portrait is optional: when no image is on file the header stays text-first.
  return (
    <header>
      {page.athlete.imageUrl ? (
        <div className="idhead">
          {/* eslint-disable-next-line @next/next/no-img-element -- v1 links external images, never re-hosts */}
          <img className="portrait" src={page.athlete.imageUrl} alt={page.athlete.fullName} />
          {identity}
        </div>
      ) : (
        identity
      )}
    </header>
  );
}

function Record({ page }: { page: AthletePage }) {
  const { record, finishRate } = page;
  return (
    <div className="record">
      <div className="record-big">
        {record.wins}<span className="loss">–{record.losses}</span>
        {record.draws > 0 ? <span className="loss">–{record.draws}</span> : null}
      </div>
      <div className="record-metrics">
        <div className="metric">
          <span className="n accent">{Math.round(finishRate * 100)}%</span>
          <span className="k">Finish rate</span>
        </div>
        <div className="metric">
          <span className="n">{record.submissionWins}</span>
          <span className="k">Submissions</span>
        </div>
        <div className="metric">
          <span className="n">{record.wins + record.losses + record.draws + record.noContests + record.dqs}</span>
          <span className="k">Matches</span>
        </div>
      </div>
    </div>
  );
}

function FinishSignature({ page }: { page: AthletePage }) {
  const { submissionBreakdown } = page;
  if (submissionBreakdown.length === 0) return null;
  const max = Math.max(...submissionBreakdown.map((s) => s.count));
  return (
    <section>
      <div className="section-head">Finish signature</div>
      <div className="finish">
        {submissionBreakdown.map((s) => (
          <div className="finish-row" key={s.type}>
            <span className="label">{s.type}</span>
            <span className="finish-bar">
              <span style={{ width: `${(s.count / max) * 100}%` }} />
            </span>
            <span className="count">{s.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function History({ page }: { page: AthletePage }) {
  return (
    <section>
      <div className="section-head">Match history</div>
      {page.matchHistory.length === 0 ? (
        <p className="empty">No matches recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="history">
            <thead>
              <tr>
                <th>Year</th><th>Event</th><th>Res</th><th>Opponent</th><th>Method</th><th>Watch</th>
              </tr>
            </thead>
            <tbody>
              {page.matchHistory.map((m) => (
                <tr key={m.matchId}>
                  <td>{year(m.date)}</td>
                  <td className="event">
                    <Link href={`/event/${m.eventSlug}`}>{m.eventName}</Link>
                  </td>
                  <td><span className={`res ${RESULT_CLASS[m.outcome]}`}>{RESULT_LABEL[m.outcome]}</span></td>
                  <td className="opp">
                    {m.opponents.map((o, i) => (
                      <span key={o.id}>
                        {i > 0 ? ", " : ""}
                        <Link href={`/athlete/${o.slug}`}>{o.name}</Link>
                      </span>
                    ))}
                  </td>
                  <td className={`method ${m.method === "SUBMISSION" ? "sub" : ""}`}>
                    {methodLabel(m.method, m.methodDetail)}
                  </td>
                  <td className="watch">
                    {m.videos.length === 0 ? (
                      <span className="none">—</span>
                    ) : (
                      m.videos.map((v, i) => (
                        <span key={v.id}>
                          {i > 0 ? " · " : ""}
                          <a href={v.url} target="_blank" rel="noreferrer">
                            {m.videos.length > 1 ? `Watch ${i + 1}` : "Watch"} ↗
                          </a>
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Medals({ page }: { page: AthletePage }) {
  if (page.placements.length === 0) return null;
  const ordinal = ["", "1st", "2nd", "3rd"];
  return (
    <section>
      <div className="section-head">Placements</div>
      <div className="medals">
        {page.placements.map((p, i) => (
          <div className={`medal ${p.place === 1 ? "gold" : ""}`} key={`${p.eventSlug}-${p.division}-${i}`}>
            <span className="place">{ordinal[p.place] ?? `${p.place}th`}</span>
            <span>{p.division} · {p.eventName} {year(p.date)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamTimeline({ page }: { page: AthletePage }) {
  if (page.teamTimeline.length === 0) return null;
  return (
    <section>
      <div className="section-head">Team history</div>
      <div className="stack">
        {page.teamTimeline.map((t, i) => (
          <div key={`${t.teamSlug}-${i}`}>
            <Link href={`/team/${t.teamSlug}`}>{t.teamName}</Link>
            {t.role ? ` · ${t.role}` : ""}
            {" · "}
            <span className={t.endDate === null ? "now" : ""}>
              {t.startDate}–{t.endDate ?? "present"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Videos({ page }: { page: AthletePage }) {
  if (page.videos.length === 0) return null;
  return (
    <section>
      <div className="section-head">Match videos</div>
      <div className="card-list">
        {page.videos.map((v) => (
          <a className="card" key={v.id} href={v.url} target="_blank" rel="noreferrer">
            <span className="t">{v.title ?? "Match video"}</span>
            <span className="s">YouTube ↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Instructionals({ page }: { page: AthletePage }) {
  if (page.instructionals.length === 0) return null;
  return (
    <section>
      <div className="section-head">Instructionals</div>
      <div className="card-list">
        {page.instructionals.map((i) => (
          <a className="card" key={i.id} href={i.affiliateUrl} target="_blank" rel="noreferrer">
            <span className="t">{i.title}</span>
            <span className="s">BJJ Fanatics ↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Sources({ page }: { page: AthletePage }) {
  const verifiedAt = page.athlete.verifiedAt;
  return (
    <div className="sources">
      Sources · {verifiedAt ? `last verified ${new Date(verifiedAt).toISOString().slice(0, 10)}` : "verification pending"}
    </div>
  );
}

function PersonJsonLd({ page }: { page: AthletePage }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: page.athlete.fullName,
    nationality: page.athlete.nationality ?? undefined,
    jobTitle: "Grappler",
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
