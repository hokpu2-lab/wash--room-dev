import { defineConfig, devices } from "@playwright/test";

const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/configured-*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report/configured" }],
      ]
    : "list",
  outputDir: "test-results/configured",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node tests/support/fake-supabase-server.mjs",
      url: "http://127.0.0.1:54390/__test/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
      url: `${baseURL}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_APP_URL: baseURL,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54390",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
        SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test_key",
      },
    },
  ],
});
