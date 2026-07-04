import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getAthlete } from "@/lib/athletes/service";
import { listInstructionalsForAthlete } from "@/lib/instructionals/service";
import { listVideosForAthlete } from "@/lib/videos/service";
import { InstructionalForm } from "./instructional-form";

export default async function AthleteHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const athlete = await getAthlete(db, id);
  if (!athlete) notFound();
  const instructionals = await listInstructionalsForAthlete(db, id);
  const videos = await listVideosForAthlete(db, id);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{athlete.fullName}</h1>
      <p>{athlete.nationality ?? "—"} · {athlete.status}</p>

      <section>
        <h2>Instructionals ({instructionals.length})</h2>
        {instructionals.length ? (
          <ul>
            {instructionals.map((i) => (
              <li key={i.id}>
                <a href={i.affiliateUrl} target="_blank" rel="noreferrer">{i.title}</a>
              </li>
            ))}
          </ul>
        ) : <p>No instructionals.</p>}
        <InstructionalForm athleteId={id} />
      </section>

      <section>
        <h2>Match video library ({videos.length})</h2>
        {videos.length ? (
          <ul>
            {videos.map((v) => (
              <li key={v.id}>
                🎬 <a href={v.url} target="_blank" rel="noreferrer">{v.title ?? v.url}</a>
              </li>
            ))}
          </ul>
        ) : <p>No videos yet.</p>}
      </section>
    </main>
  );
}
