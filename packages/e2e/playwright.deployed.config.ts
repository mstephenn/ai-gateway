import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for auditing the deployed AI Gateway UI.
 *
 * Usage:
 *   DEPLOYED_URL=https://aigateway.optisolbusiness.com/ui \
 *     pnpm exec playwright test --config=playwright.deployed.config.ts
 *
 * The test pauses at the login screen so you can authenticate manually.
 */

const DEPLOYED_URL = process.env["DEPLOYED_URL"] || "https://aigateway.optisolbusiness.com/ui";

export default defineConfig({
  testDir: "./tests",
  testMatch: "model-management-deployed.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: DEPLOYED_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
        },
      },
    },
  ],
  // No local webServer — tests run against the deployed URL.
});
