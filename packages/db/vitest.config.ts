import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `pnpm build` emits compiled test files into dist. Run the TypeScript
    // source suite only so a build does not execute every database test twice
    // (or start duplicate embedded Postgres instances).
    include: ["src/**/*.test.ts"],
  },
});
