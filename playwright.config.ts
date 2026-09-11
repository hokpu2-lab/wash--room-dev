import { defineConfig, devices } from "@playwright/test";

import { serviceRoleSecretSentinel } from "./tests/support/e2e-constants";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/configured-*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/public" }]]
    : "list",
  outputDir: "test-results/public",
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
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/status`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleSecretSentinel,
    },
  },
});
