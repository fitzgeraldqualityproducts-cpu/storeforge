-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "inputs" TEXT NOT NULL DEFAULT '{}',
    "rightsAck" TEXT NOT NULL DEFAULT '{"accepted":false,"at":null}',
    "steps" TEXT NOT NULL DEFAULT '{}',
    "extractions" TEXT NOT NULL DEFAULT '[]',
    "analysis" TEXT,
    "brandKit" TEXT,
    "listing" TEXT,
    "content" TEXT,
    "listingMeta" TEXT,
    "imageOptions" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "new_Project" ("analysis", "brandKit", "content", "createdAt", "extractions", "id", "inputs", "listing", "listingMeta", "name", "rightsAck", "status", "steps", "updatedAt") SELECT "analysis", "brandKit", "content", "createdAt", "extractions", "id", "inputs", "listing", "listingMeta", "name", "rightsAck", "status", "steps", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
