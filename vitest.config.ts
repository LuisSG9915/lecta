import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      include: ["src/shared/**/*.ts", "src/client/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "src/client/types/**"],
      thresholds: {
        lines: 75,
        functions: 72,
        "src/shared/**": {
          lines: 85,
          functions: 90,
        },
        "src/client/lib/**": {
          lines: 75,
          functions: 72,
        },
      },
    },
  },
});
