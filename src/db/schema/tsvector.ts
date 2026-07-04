import { customType } from "drizzle-orm/pg-core";

// Postgres tsvector. We never write to it (it is a generated column); it exists in the
// schema so the ORM is aware of the column and drizzle-kit will not try to drop it.
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
