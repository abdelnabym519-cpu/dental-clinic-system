-- Phase 8 — Canonical AI Memory (additive).
--
-- Two new tables (AiMemoryItem, AiMemoryEvent). No existing table, column,
-- index or row is altered or dropped.
--
-- COLLATION (repair note): both tables carry the project-wide table option
-- `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` (the same
-- option every earlier migration sets). Without it they inherit the SERVER
-- default (utf8mb4_0900_ai_ci on mysql:8.4) and their FKs to Hospital.id
-- fail with MySQL 3780 — the canonical tenant key's collation wins. No native ENUM types — union values
-- are documented String columns (same convention as Phase 4 knowledge and
-- Phase 6 multimodal migrations); the TS layer (lib/ai/memory) is the typed
-- source of truth and validates every write.
--
--   AiMemoryItem — the single persistent memory store. Scope is (domain +
--   the matching scope columns): CLINIC → hospitalId only, DOCTOR →
--   doctorId, PATIENT → patientId, CASE → caseId (a case IS a Treatment
--   row), CONVERSATION → conversationId. hospitalId is the tenant root —
--   every retrieval is tenant-scoped at the query level.
--
--   AiMemoryEvent — the memory audit trail (write/correct/supersede/
--   invalidate/delete/expire) with actor, reason and value snapshots.
--   Corrections NEVER mutate the original row: the old row keeps its
--   content with status SUPERSEDED/INVALIDATED + supersededBy, and the
--   event stores both value snapshots (same policy class as AuditLog's
--   oldValues/newValues — tenant-scoped, never public).
--
-- Retention is explicit per domain via expiresAt (set from the
-- tenant-configurable policy at write time; Phase 8 doc §14 documents
-- these as implementation decisions, not legal requirements).
--
-- Rollback (if ever needed):
--   DROP TABLE `AiMemoryEvent`;
--   DROP TABLE `AiMemoryItem`;

CREATE TABLE `AiMemoryItem` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `memoryType` VARCHAR(191) NOT NULL,
    `trustLevel` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `doctorId` VARCHAR(191) NULL,
    `patientId` VARCHAR(191) NULL,
    `caseId` VARCHAR(191) NULL,
    `conversationId` VARCHAR(191) NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `confidence` JSON NULL,
    `sourceKind` VARCHAR(191) NOT NULL,
    `sourceRef` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdByIdType` VARCHAR(191) NOT NULL,
    `validFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `supersededBy` VARCHAR(191) NULL,
    `correctionReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    CONSTRAINT `AiMemoryItem_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `AiMemoryItem_hospitalId_domain_status_idx` ON `AiMemoryItem`(`hospitalId`, `domain`, `status`);
CREATE INDEX `AiMemoryItem_hospitalId_doctorId_status_idx` ON `AiMemoryItem`(`hospitalId`, `doctorId`, `status`);
CREATE INDEX `AiMemoryItem_hospitalId_patientId_domain_status_idx` ON `AiMemoryItem`(`hospitalId`, `patientId`, `domain`, `status`);
CREATE INDEX `AiMemoryItem_hospitalId_caseId_status_idx` ON `AiMemoryItem`(`hospitalId`, `caseId`, `status`);
CREATE INDEX `AiMemoryItem_hospitalId_conversationId_status_idx` ON `AiMemoryItem`(`hospitalId`, `conversationId`, `status`);
CREATE INDEX `AiMemoryItem_hospitalId_expiresAt_idx` ON `AiMemoryItem`(`hospitalId`, `expiresAt`);

CREATE TABLE `AiMemoryEvent` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `memoryId` VARCHAR(191) NOT NULL,
    `eventKind` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT `AiMemoryEvent_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `AiMemoryEvent_hospitalId_memoryId_idx` ON `AiMemoryEvent`(`hospitalId`, `memoryId`);
CREATE INDEX `AiMemoryEvent_hospitalId_createdAt_idx` ON `AiMemoryEvent`(`hospitalId`, `createdAt`);

ALTER TABLE `AiMemoryItem` ADD CONSTRAINT `AiMemoryItem_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiMemoryEvent` ADD CONSTRAINT `AiMemoryEvent_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
