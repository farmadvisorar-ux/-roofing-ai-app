-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "ownerName" TEXT,
    "parcelId" TEXT,
    "osmRef" TEXT,
    "footprintSqFt" REAL,
    "buildingLevels" INTEGER,
    "roofShape" TEXT,
    "roofMaterial" TEXT,
    "yearBuilt" INTEGER,
    "roofSqFt" REAL,
    "roofSquares" REAL,
    "estimateLow" REAL,
    "estimateHigh" REAL,
    "enrichmentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "enrichmentSources" TEXT,
    "enrichmentError" TEXT,
    "enrichedAt" DATETIME,
    "notes" TEXT,
    "leadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Property_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_osmRef_key" ON "Property"("osmRef");

-- CreateIndex
CREATE UNIQUE INDEX "Property_leadId_key" ON "Property"("leadId");

-- CreateIndex
CREATE INDEX "Property_lat_lng_idx" ON "Property"("lat", "lng");
