import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const PORT = process.env["E2E_UI_PORT"] || "8080";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    cwd: REPO_ROOT,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      E2E_UI_PORT: PORT,
      PORT: "4000",
      VITE_API_BASE_URL: "http://localhost:4000",
      ADMIN_BOOTSTRAP_KEY: "sk-e2e-admin-test-key",
      DATABASE_URL:
        process.env["DATABASE_URL"] ||
        "postgresql://ai_gateway:ai_gateway@localhost:5432/ai_gateway?schema=public",
      REDIS_URL: process.env["REDIS_URL"] || "redis://localhost:6379",
      CORS_ALLOWED_ORIGINS: BASE_URL,
    },
  },
});
