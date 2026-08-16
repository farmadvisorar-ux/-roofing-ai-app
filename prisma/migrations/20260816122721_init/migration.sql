-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'CONFIGURATOR',
    "estimatedValue" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShedConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "widthFt" REAL NOT NULL,
    "lengthFt" REAL NOT NULL,
    "wallHeightFt" REAL NOT NULL,
    "roofStyle" TEXT NOT NULL DEFAULT 'GABLE',
    "roofPitch" REAL NOT NULL DEFAULT 4,
    "sidingColor" TEXT NOT NULL DEFAULT '#c9c2b4',
    "trimColor" TEXT NOT NULL DEFAULT '#ffffff',
    "roofColor" TEXT NOT NULL DEFAULT '#3a3f44',
    "doorCount" INTEGER NOT NULL DEFAULT 1,
    "doorWidthFt" REAL NOT NULL DEFAULT 3,
    "windowCount" INTEGER NOT NULL DEFAULT 2,
    "price" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShedConfig_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalPrice" REAL NOT NULL,
    "downPayment" REAL NOT NULL DEFAULT 0,
    "apr" REAL NOT NULL DEFAULT 0,
    "termMonths" INTEGER NOT NULL DEFAULT 0,
    "monthlyPayment" REAL NOT NULL DEFAULT 0,
    "signerName" TEXT,
    "signatureData" TEXT,
    "signedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contract_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShedConfig_leadId_key" ON "ShedConfig"("leadId");
