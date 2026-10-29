import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5188",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit-iphone",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
      grep: process.env.CI ? /@smoke/ : /\[webkit\]|@smoke/,
    },
  ],
  webServer: {
    command: process.env.CI
      ? "pnpm exec vite preview --port 5188"
      : "pnpm run build && pnpm exec vite preview --port 5188",
    url: "http://localhost:5188",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
        "postgresql://mock:mock@localhost:5432/mock",
    },
  },
});
