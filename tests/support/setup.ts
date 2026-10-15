import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// Each test run gets an isolated data directory + SQLite database.
const root = path.resolve(__dirname, "..", ".tmp", `run-${process.pid}`);
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
process.env.DATA_DIR = path.join(root, "data");
process.env.DATABASE_URL = `file:${path.join(root, "test.db")}`;
process.env.AI_MODE = "fixture";
process.env.STOREFORGE_QUIET = "1";
process.env.FONT_DOWNLOADS = "off";
process.env.ANTHROPIC_API_KEY = "";
process.env.SHOPIFY_STORE_DOMAIN = "";
process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "";
execSync("npx prisma migrate deploy", {
  stdio: "ignore",
  env: { ...process.env },
  cwd: path.resolve(__dirname, "..", ".."),
});
