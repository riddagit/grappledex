import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Each test spins up an in-process pglite DB and replays every migration.
    // Under parallel load that setup can exceed the 5s default as migrations
    // accumulate, so allow more headroom to keep the suite deterministic.
    testTimeout: 20000,
  },
});
