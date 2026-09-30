-- Phase 6 — Multimodal Dental AI (additive).
--
-- Additive only: one new table and three new native MySQL enum types.
-- No existing table is altered.
--
--   MultimodalAttachment — the canonical chat attachment contract. Every
--   descriptive field is server-derived (magic-byte MIME, computed SHA-256,
--   sanitized display name, tenant-prefixed storage key). A
--   patient-attributed attachment with an established modality also gets an
--   ImagingStudy row (reused, not duplicated); this table holds the
--   chat-specific context: conversation, source, extraction, capability.

-- CreateTable
CREATE TABLE `MultimodalAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NULL,
    `caseId` VARCHAR(191) NULL,
    `conversationId` VARCHAR(191) NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mediaType` VARCHAR(191) NOT NULL,
    `fileClass` ENUM('IMAGE_2D', 'MESH_3D', 'DOCUMENT_PDF', 'DOCUMENT_TEXT', 'VOLUME_DICOM', 'UNKNOWN') NOT NULL,
    `dentalModality` VARCHAR(191) NULL,
    `modalityOrigin` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `dentalImageState` VARCHAR(191) NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `source` ENUM('CHAT_UPLOAD', 'CLINIC_DOCUMENT', 'SYSTEM') NOT NULL DEFAULT 'CHAT_UPLOAD',
    `status` ENUM('RECEIVED', 'VALIDATED', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `failureCode` VARCHAR(191) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `pixelCount` INTEGER NULL,
    `pageCount` INTEGER NULL,
    `extractedTextKey` VARCHAR(191) NULL,
    `studyId` VARCHAR(191) NULL,
    `provenance` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    CONSTRAINT `MultimodalAttachment_pkey` PRIMARY KEY (`id`)
);

-- CreateIndex
CREATE UNIQUE INDEX `MultimodalAttachment_storageKey_key` ON `MultimodalAttachment`(`storageKey`);
CREATE INDEX `MultimodalAttachment_hospitalId_idx` ON `MultimodalAttachment`(`hospitalId`);
CREATE INDEX `MultimodalAttachment_hospitalId_patientId_idx` ON `MultimodalAttachment`(`hospitalId`, `patientId`);
CREATE INDEX `MultimodalAttachment_conversationId_idx` ON `MultimodalAttachment`(`conversationId`);
CREATE INDEX `MultimodalAttachment_studyId_idx` ON `MultimodalAttachment`(`studyId`);

-- AddForeignKey
ALTER TABLE `MultimodalAttachment` ADD CONSTRAINT `MultimodalAttachment_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MultimodalAttachment` ADD CONSTRAINT `MultimodalAttachment_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
