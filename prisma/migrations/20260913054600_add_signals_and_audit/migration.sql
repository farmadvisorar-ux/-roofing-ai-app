-- AlterTable
ALTER TABLE "Property" ADD COLUMN "assessedValue" REAL;
ALTER TABLE "Property" ADD COLUMN "lastPermitDate" DATETIME;
ALTER TABLE "Property" ADD COLUMN "lastPermitType" TEXT;
ALTER TABLE "Property" ADD COLUMN "lastSaleDate" DATETIME;
ALTER TABLE "Property" ADD COLUMN "lastSalePrice" REAL;
ALTER TABLE "Property" ADD COLUMN "leadScore" INTEGER;
ALTER TABLE "Property" ADD COLUMN "leadScoreBand" TEXT;
ALTER TABLE "Property" ADD COLUMN "peakGustMph" REAL;
ALTER TABLE "Property" ADD COLUMN "roofPermitDate" DATETIME;
ALTER TABLE "Property" ADD COLUMN "scoreComponents" TEXT;
ALTER TABLE "Property" ADD COLUMN "scoreConfidence" REAL;
ALTER TABLE "Property" ADD COLUMN "scoredAt" DATETIME;
ALTER TABLE "Property" ADD COLUMN "severeStormDays" INTEGER;
ALTER TABLE "Property" ADD COLUMN "stormWindowYears" INTEGER;

-- CreateTable
CREATE TABLE "PropertyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropertyEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PropertyEvent_propertyId_createdAt_idx" ON "PropertyEvent"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "Property_leadScore_idx" ON "Property"("leadScore");

-- CreateIndex
CREATE INDEX "Property_enrichmentStatus_idx" ON "Property"("enrichmentStatus");
