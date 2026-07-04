import Link from "next/link";
import { db } from "@/db/client";
import { listInstructionals } from "@/lib/instructionals/service";

export default async function InstructionalsBrowsePage() {
  const instructionals = await listInstructionals(db);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Instructionals ({instructionals.length})</h1>
      {instructionals.length ? (
        <ul>
          {instructionals.map((i) => (
            <li key={i.id}>
              <a href={i.affiliateUrl} target="_blank" rel="noreferrer">{i.title}</a>
              {" — "}
              <Link href={`/admin/athletes/${i.athleteId}`}>{i.instructorName}</Link>
            </li>
          ))}
        </ul>
      ) : <p>No instructionals yet.</p>}
    </main>
  );
}
