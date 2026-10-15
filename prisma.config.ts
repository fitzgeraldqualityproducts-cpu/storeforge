import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; load it (then .env) so the Prisma CLI sees the same DATABASE_URL.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./data/storeforge.db",
  },
});
