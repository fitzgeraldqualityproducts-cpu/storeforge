import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

function resolveDbUrl(): string {
  const raw = process.env.DATABASE_URL?.trim() || "file:./data/storeforge.db";
  const file = raw.replace(/^file:/, "");
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

const globalForPrisma = globalThis as unknown as { __storeforgePrisma?: PrismaClient };

function create() {
  const adapter = new PrismaBetterSqlite3({ url: resolveDbUrl() });
  return new PrismaClient({ adapter });
}

/** Single Prisma client per process (survives dev hot reloads). */
export const prisma: PrismaClient = globalForPrisma.__storeforgePrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.__storeforgePrisma = prisma;
