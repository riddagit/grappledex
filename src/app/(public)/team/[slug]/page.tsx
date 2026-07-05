import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getTeamPage, type RosterMember } from "@/lib/public/team-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getTeamPage(db, slug);
  if (!page) return { title: "Not found — Grappledex" };
  const title = `${page.team.name} — roster & alumni — Grappledex`;
  const description = `${page.team.name} grappling team: current roster and notable alumni.`;
  return { title, description, openGraph: { title, description } };
}

export default async function TeamPublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getTeamPage(db, slug);
  if (!page) notFound();
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow"><span>Team</span></div>
        <h1 className="athlete-name">{page.team.name}</h1>
      </header>
      <Roster title="Current roster" members={page.current} />
      <Roster title="Alumni" members={page.alumni} />
    </main>
  );
}

function Roster({ title, members }: { title: string; members: RosterMember[] }) {
  if (members.length === 0) return null;
  return (
    <section>
      <div className="section-head">{title}</div>
      <div className="stack">
        {members.map((m) => (
          <div key={m.athleteId}>
            <Link href={`/athlete/${m.slug}`}>{m.name}</Link>
            {m.role ? ` · ${m.role}` : ""}
            {" · "}
            <span className={m.endDate === null ? "now" : ""}>
              {m.startDate ?? "unknown"}–{m.endDate ?? "present"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
