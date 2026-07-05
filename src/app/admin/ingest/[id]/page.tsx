import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getBatch } from "@/lib/ingestion/service";
import { ReviewQueue } from "./review";

export default async function ReviewPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await getBatch(db, id);
  if (!loaded) notFound();

  return (
    <main style={{ maxWidth: 860, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Review batch</h1>
      <p>Status: {loaded.batch.status}{loaded.batch.error ? ` — ${loaded.batch.error}` : ""}</p>
      <ReviewQueue batchId={id} candidates={loaded.candidates} committed={loaded.batch.status === "committed"} />
    </main>
  );
}
