-- CreateTable
CREATE TABLE "StormIngestDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reports" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StormEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "magnitude" REAL,
    "state" TEXT,
    "sourceKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'archive',
    "preliminary" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_StormEvent" ("id", "kind", "lat", "lng", "magnitude", "occurredAt", "sourceKey", "state") SELECT "id", "kind", "lat", "lng", "magnitude", "occurredAt", "sourceKey", "state" FROM "StormEvent";
DROP TABLE "StormEvent";
ALTER TABLE "new_StormEvent" RENAME TO "StormEvent";
CREATE UNIQUE INDEX "StormEvent_sourceKey_key" ON "StormEvent"("sourceKey");
CREATE INDEX "StormEvent_occurredAt_idx" ON "StormEvent"("occurredAt");
CREATE INDEX "StormEvent_lat_lng_idx" ON "StormEvent"("lat", "lng");
CREATE INDEX "StormEvent_preliminary_idx" ON "StormEvent"("preliminary");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "StormIngestDay_day_idx" ON "StormIngestDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "StormIngestDay_day_kind_key" ON "StormIngestDay"("day", "kind");
