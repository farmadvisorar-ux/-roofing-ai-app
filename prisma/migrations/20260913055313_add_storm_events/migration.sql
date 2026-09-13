-- AlterTable
ALTER TABLE "Property" ADD COLUMN "hailEventsNearby" INTEGER;
ALTER TABLE "Property" ADD COLUMN "hailSearchRadiusMi" REAL;
ALTER TABLE "Property" ADD COLUMN "hailWindowYears" INTEGER;
ALTER TABLE "Property" ADD COLUMN "lastHailDate" DATETIME;
ALTER TABLE "Property" ADD COLUMN "maxHailInches" REAL;

-- CreateTable
CREATE TABLE "StormEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "magnitude" REAL,
    "state" TEXT,
    "sourceKey" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "StormEvent_sourceKey_key" ON "StormEvent"("sourceKey");

-- CreateIndex
CREATE INDEX "StormEvent_occurredAt_idx" ON "StormEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "StormEvent_lat_lng_idx" ON "StormEvent"("lat", "lng");
