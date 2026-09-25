-- Phase 19A — AI Platform Infrastructure + Liodon PoC (D7–D9).
--
-- Additive only: two new tables and four new native MySQL enum types.
-- No existing table is altered.
--
--   ImagingStudy  — an uploaded imaging object (original is IMMUTABLE; the
--                   AI stack never writes to `originalKey`).
--   AIAnalysisJob — one AI run against a study; the orchestrator owns the
--                   processing transitions, Next.js owns creation + review.
--
-- Provenance is stored both as explicit columns (modelVersion/
-- modelChecksum/modelSource/modelLicense/orchestratorVersion) and as the
-- assembled `provenance` JSON blob (spec section 13), so every completed
-- analysis is reproducible/auditable without a separate AIResult table
-- (findings + rawOutputKey live on the job — D9 decision).

-- CreateTable: ImagingStudy
CREATE TABLE `ImagingStudy` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NULL,
    `studyType` VARCHAR(191) NOT NULL,
    `modality` ENUM('PANORAMIC', 'PERIAPICAL', 'BITEWING', 'CBCT', 'THREE_D_SCAN', 'PHOTO') NOT NULL,
    `originalKey` VARCHAR(191) NOT NULL,
    `originalSize` INTEGER NOT NULL,
    `originalHash` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `studyDate` DATETIME(3) NULL,
    `description` TEXT NULL,
    `uploadedById` VARCHAR(191) NULL,
    `status` ENUM('UPLOADED', 'ANALYZED', 'REVIEWED') NOT NULL DEFAULT 'UPLOADED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    CONSTRAINT `ImagingStudy_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: AIAnalysisJob
CREATE TABLE `AIAnalysisJob` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `studyId` VARCHAR(191) NOT NULL,
    `engine` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NULL,
    `modelVersion` VARCHAR(191) NULL,
    `modelChecksum` VARCHAR(191) NULL,
    `modelSource` VARCHAR(191) NULL,
    `modelLicense` VARCHAR(191) NULL,
    `orchestratorVersion` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `processingTimeMs` INTEGER NULL,
    `rawOutputKey` VARCHAR(191) NULL,
    `findings` JSON NULL,
    `confidence` DOUBLE NULL,
    `errorMessage` TEXT NULL,
    `provenance` JSON NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewDecision` ENUM('ACCEPTED', 'MODIFIED', 'REJECTED') NULL,
    `reviewNotes` TEXT NULL,
    `acceptedFindings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    CONSTRAINT `AIAnalysisJob_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex (unique)
CREATE UNIQUE INDEX `ImagingStudy_originalKey_key` ON `ImagingStudy`(`originalKey`);

-- CreateIndex
CREATE INDEX `ImagingStudy_hospitalId_idx` ON `ImagingStudy`(`hospitalId`);
CREATE INDEX `ImagingStudy_hospitalId_patientId_idx` ON `ImagingStudy`(`hospitalId`, `patientId`);
CREATE INDEX `ImagingStudy_status_idx` ON `ImagingStudy`(`status`);
CREATE INDEX `AIAnalysisJob_hospitalId_idx` ON `AIAnalysisJob`(`hospitalId`);
CREATE INDEX `AIAnalysisJob_studyId_idx` ON `AIAnalysisJob`(`studyId`);
CREATE INDEX `AIAnalysisJob_status_idx` ON `AIAnalysisJob`(`status`);
CREATE INDEX `AIAnalysisJob_hospitalId_status_idx` ON `AIAnalysisJob`(`hospitalId`, `status`);

-- AddForeignKey
ALTER TABLE `ImagingStudy` ADD CONSTRAINT `ImagingStudy_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ImagingStudy` ADD CONSTRAINT `ImagingStudy_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ImagingStudy` ADD CONSTRAINT `ImagingStudy_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ImagingStudy` ADD CONSTRAINT `ImagingStudy_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AIAnalysisJob` ADD CONSTRAINT `AIAnalysisJob_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AIAnalysisJob` ADD CONSTRAINT `AIAnalysisJob_studyId_fkey` FOREIGN KEY (`studyId`) REFERENCES `ImagingStudy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AIAnalysisJob` ADD CONSTRAINT `AIAnalysisJob_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AIAnalysisJob` ADD CONSTRAINT `AIAnalysisJob_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
