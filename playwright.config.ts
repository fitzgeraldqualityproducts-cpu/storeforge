import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end run: the fixture product site on 127.0.0.1:4555 and a production build of the app
 * in fixture AI mode on :3210, with an isolated database and data folder in the OS temp folder
 * (outside the project, so writes never trigger the file watcher).
 */
const PORT = 3210;
const E2E_DIR = path.join(os.tmpdir(), "storeforge-e2e");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: "npx tsx tests/support/fixture-server.ts",
      url: "http://127.0.0.1:4555/product.html",
      reuseExistingServer: true,
      env: { FIXTURE_PORT: "4555" },
    },
    {
      command: `rm -rf ${E2E_DIR} && mkdir -p ${E2E_DIR} && npx prisma migrate deploy && npx next build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/capabilities`,
      reuseExistingServer: false,
      timeout: 600_000,
      env: {
        DATABASE_URL: `file:${E2E_DIR}/e2e.db`,
        DATA_DIR: path.join(E2E_DIR, "data"),
        AI_MODE: "fixture",
        SCRAPE_ALLOWLIST: "127.0.0.1:4555",
        FONT_DOWNLOADS: "off",
        APP_BASE_URL: `http://localhost:${PORT}`,
        SHOPIFY_STORE_DOMAIN: "",
        SHOPIFY_ADMIN_ACCESS_TOKEN: "",
        STOREFORGE_QUIET: "1",
      },
    },
  ],
});
