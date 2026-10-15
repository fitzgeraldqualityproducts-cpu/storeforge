// Ensures the data directory exists and the SQLite schema is migrated before the app starts.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

mkdirSync(path.join(process.cwd(), "data", "projects"), { recursive: true });
mkdirSync(path.join(process.cwd(), "data", "exports"), { recursive: true });
execSync("npx prisma migrate deploy", { stdio: ["ignore", "ignore", "inherit"] });
