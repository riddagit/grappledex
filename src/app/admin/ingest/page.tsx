import { IngestForm } from "./ingest-form";

export default function IngestPage() {
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Assisted ingestion</h1>
      <p>Paste event results, an article, or a bracket. Claude extracts records to review.</p>
      <IngestForm />
    </main>
  );
}
