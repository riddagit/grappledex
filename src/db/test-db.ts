import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export async function createTestDb() {
  const client = new PGlite(); // in-memory
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
