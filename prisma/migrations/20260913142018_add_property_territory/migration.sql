-- AlterTable
ALTER TABLE "Property" ADD COLUMN "territory" TEXT;

-- CreateIndex
CREATE INDEX "Property_territory_idx" ON "Property"("territory");
