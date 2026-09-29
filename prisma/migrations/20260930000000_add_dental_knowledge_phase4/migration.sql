-- Phase 4 — Dental Knowledge Layer (RAG): additive knowledge tables.
--
-- Three new tables (KnowledgeSource, KnowledgeDocument, KnowledgeChunk).
-- No existing table, column, index or row is altered or dropped.
-- Knowledge content is GENERAL dental information stored strictly as DATA —
-- patient-specific data is never indexed here (patient separation).
--
-- Dedup/identity:
--   * KnowledgeSource(sourceKey, version) — same URL/identity + same version
--     cannot be re-registered.
--   * KnowledgeDocument(contentHash)      — identical normalized content is
--     never indexed twice (corpus-level dedup, enforced by the ingestion
--     pipeline as a typed rejection, backstopped by this constraint).
--   * KnowledgeChunk(documentId, position) — deterministic chunk identity.
--
-- Version history stays distinguishable: documents of the same source keep
-- their own rows (status PUBLISHED / SUPERSEDED); a newer version marks the
-- older one SUPERSEDED (supersededByKnowledgeDocumentId), never deletes it.
--
-- Rollback (if ever needed):
--   ALTER TABLE `Hospital` ... (no column added to Hospital by SQL);
--   DROP TABLE `KnowledgeChunk`;
--   DROP TABLE `KnowledgeDocument`;
--   DROP TABLE `KnowledgeSource`;

CREATE TABLE `KnowledgeSource` (
    `id` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `publisher` VARCHAR(191) NOT NULL,
    `authors` VARCHAR(191) NULL,
    `publicationDate` DATETIME(3) NULL,
    `lastUpdated` DATETIME(3) NULL,
    `reference` VARCHAR(191) NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `authorityTier` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `subtopic` VARCHAR(191) NULL,
    `jurisdiction` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NULL,
    `license` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NOT NULL DEFAULT 'GLOBAL',
    `hospitalId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PUBLISHED',
    `rejectReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    CONSTRAINT `KnowledgeSource_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `KnowledgeSource_sourceKey_version_key`
    ON `KnowledgeSource`(`sourceKey`, `version`);
CREATE INDEX `KnowledgeSource_status_domain_authorityTier_idx`
    ON `KnowledgeSource`(`status`, `domain`, `authorityTier`);
CREATE INDEX `KnowledgeSource_hospitalId_idx` ON `KnowledgeSource`(`hospitalId`);

ALTER TABLE `KnowledgeSource`
    ADD CONSTRAINT `KnowledgeSource_hospitalId_fkey`
    FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `KnowledgeDocument` (
    `id` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `contentText` LONGTEXT NOT NULL,
    `contentHash` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL,
    `wordCount` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PUBLISHED',
    `ingestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ingestion` JSON NULL,
    `supersededByKnowledgeDocumentId` VARCHAR(191) NULL,

    CONSTRAINT `KnowledgeDocument_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `KnowledgeDocument_sourceId_version_key`
    ON `KnowledgeDocument`(`sourceId`, `version`);
CREATE UNIQUE INDEX `KnowledgeDocument_contentHash_key`
    ON `KnowledgeDocument`(`contentHash`);
CREATE INDEX `KnowledgeDocument_status_idx` ON `KnowledgeDocument`(`status`);

ALTER TABLE `KnowledgeDocument`
    ADD CONSTRAINT `KnowledgeDocument_sourceId_fkey`
    FOREIGN KEY (`sourceId`) REFERENCES `KnowledgeSource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `KnowledgeDocument`
    ADD CONSTRAINT `KnowledgeDocument_supersededByKnowledgeDocumentId_fkey`
    FOREIGN KEY (`supersededByKnowledgeDocumentId`) REFERENCES `KnowledgeDocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `KnowledgeChunk` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `subtopic` VARCHAR(191) NULL,
    `section` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `tokenCount` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL,

    CONSTRAINT `KnowledgeChunk_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `KnowledgeChunk_documentId_position_key`
    ON `KnowledgeChunk`(`documentId`, `position`);
CREATE INDEX `KnowledgeChunk_sourceId_domain_idx`
    ON `KnowledgeChunk`(`sourceId`, `domain`);
CREATE INDEX `KnowledgeChunk_checksum_idx` ON `KnowledgeChunk`(`checksum`);

ALTER TABLE `KnowledgeChunk`
    ADD CONSTRAINT `KnowledgeChunk_documentId_fkey`
    FOREIGN KEY (`documentId`) REFERENCES `KnowledgeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
