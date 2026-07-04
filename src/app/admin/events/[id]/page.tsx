import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getEvent } from "@/lib/events/service";
import { listMatchesForEvent } from "@/lib/matches/service";
import { listPlacementsForEvent } from "@/lib/placements/service";
import { listVideosForEvent } from "@/lib/videos/service";
import { MatchForm } from "./match-form";
import { PlacementForm } from "./placement-form";
import { VideoForm } from "./video-form";

export default async function EventHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getEvent(db, id);
  if (!event) notFound();
  const matches = await listMatchesForEvent(db, id);
  const placements = await listPlacementsForEvent(db, id);
  const videos = await listVideosForEvent(db, id);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>{event.name}</h1>
      <p>{event.startDate}{event.location ? ` · ${event.location}` : ""}</p>

      <section>
        <h2>Matches ({matches.length})</h2>
        <ul>
          {matches.map((m) => {
            const matchVideos = videos.filter((v) => v.matchId === m.id);
            return (
              <li key={m.id}>
                {m.matchType} · {m.weightClass ?? "—"} · {m.method}{m.methodDetail ? ` (${m.methodDetail})` : ""}
                {matchVideos.length > 0 && (
                  <ul>
                    {matchVideos.map((v) => (
                      <li key={v.id}>
                        🎬 <a href={v.url} target="_blank" rel="noreferrer">{v.title ?? v.url}</a>
                      </li>
                    ))}
                  </ul>
                )}
                <VideoForm matchId={m.id} />
              </li>
            );
          })}
        </ul>
        <MatchForm eventId={id} />
      </section>

      <section>
        <h2>Placements ({placements.length})</h2>
        <ul>
          {placements.map((p) => (
            <li key={p.id}>{p.division} · #{p.place}</li>
          ))}
        </ul>
        <PlacementForm eventId={id} />
      </section>
    </main>
  );
}
