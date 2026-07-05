/**
 * CLI entry for the demo seed. Run with `npm run db:seed` after `npm run db:migrate`.
 *
 * Uses its own postgres-js connection (rather than the shared `@/db/client`) so the
 * process can `sql.end()` and exit cleanly instead of hanging on an open pool.
 *
 * Reads DATABASE_URL from the environment; `npm run db:seed` loads `.env.local` via
 * Node's --env-file-if-exists flag.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as raw } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { seed } from "@/db/seed";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example), " +
        "then run `npm run db:migrate` before seeding.",
    );
    process.exit(1);
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // Guard against double-seeding: the demo seed is not idempotent.
    const rows = await db.execute<{ count: number }>(
      raw`select count(*)::int as count from athletes`,
    );
    const count = rows[0]?.count ?? 0;
    if (count > 0) {
      console.error(
        `Refusing to seed: 'athletes' already has ${count} row(s). ` +
          "The demo seed is additive, not idempotent. Reset the database first.",
      );
      process.exit(1);
    }

    const result = await seed(db);
    console.log(
      `Seeded demo data: ${Object.keys(result.athletes).length} athletes, ` +
        `1 event, ${Object.keys(result.matches).length} matches.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
