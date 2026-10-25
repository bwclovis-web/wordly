-- AlterTable
ALTER TABLE "Source" ADD COLUMN "originalFilename" TEXT;

-- CreateTable
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportedFile_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChangePackage" (
    "packageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "formatVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("projectId", "packageId"),
    CONSTRAINT "ChangePackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ChangePackage" ("appliedAt", "contentHash", "formatVersion", "packageId", "projectId", "rawJson", "resultJson", "status", "summary") SELECT "appliedAt", "contentHash", "formatVersion", "packageId", "projectId", "rawJson", "resultJson", "status", "summary" FROM "ChangePackage";
DROP TABLE "ChangePackage";
ALTER TABLE "new_ChangePackage" RENAME TO "ChangePackage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ImportedFile_projectId_contentHash_idx" ON "ImportedFile"("projectId", "contentHash");

-- CreateIndex
CREATE INDEX "ImportedFile_recordId_idx" ON "ImportedFile"("recordId");

