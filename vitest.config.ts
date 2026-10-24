import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts"],
      // A floor that only ever goes up (raise it when the real numbers pass it by a few points).
      thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
    },
  },
});
