import { defineConfig, devices } from "@playwright/test";

/**
 * E2E flows for VIZORA. Run with `npm run test:e2e`.
 * Set PW_CHROMIUM to point at a preinstalled Chromium if needed.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 150_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:3100",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM }
      : undefined,
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
