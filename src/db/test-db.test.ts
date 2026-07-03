import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import { athletes } from "@/db/schema/athlete";

describe("createTestDb", () => {
  it("provides a migrated database that can insert and read athletes", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(athletes).values({ slug: "test-user", fullName: "Test User" });
      const rows = await db.select().from(athletes);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.slug).toBe("test-user");
      expect(rows[0]?.status).toBe("draft"); // default applied
    } finally {
      await close();
    }
  });
});
