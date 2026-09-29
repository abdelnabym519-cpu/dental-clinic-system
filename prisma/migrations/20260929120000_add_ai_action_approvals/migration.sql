-- Phase 1 — AI Guardrails & Action Safety: additive ledger/approval table.
--
-- One new table (AIActionApproval) + one new enum (AIActionStatus). No
-- existing table, column, index or row is altered or dropped. The three
-- new foreign keys reference existing primary keys and use
-- ON DELETE CASCADE (tenant/user) or SET NULL (approvedBy, patient) so
-- deleting a hospital/user cleans up its AI safety rows without breaking
-- anything else, and an approver/patient deletion keeps the audit history.
--
-- Rollback (if ever needed): DROP TABLE `AIActionApproval`;
-- (the enum lives inside the table in MySQL, so nothing else to drop).

CREATE TABLE `AIActionApproval` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `patientId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `params` JSON NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `riskLevel` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `requiresApproval` BOOLEAN NOT NULL DEFAULT true,
    `policyVersion` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'EXECUTED', 'BLOCKED') NOT NULL DEFAULT 'PENDING',
    `blockReason` VARCHAR(191) NULL,
    `requestReason` TEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `decidedNote` TEXT NULL,
    `executedAt` DATETIME(3) NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    CONSTRAINT `AIActionApproval_pkey` PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `AIActionApproval_hospitalId_status_idx` ON `AIActionApproval`(`hospitalId`, `status`);
CREATE INDEX `AIActionApproval_fingerprint_idx` ON `AIActionApproval`(`fingerprint`);
CREATE INDEX `AIActionApproval_requestedById_idx` ON `AIActionApproval`(`requestedById`);
CREATE INDEX `AIActionApproval_patientId_idx` ON `AIActionApproval`(`patientId`);
CREATE INDEX `AIActionApproval_expiresAt_idx` ON `AIActionApproval`(`expiresAt`);

ALTER TABLE `AIActionApproval` ADD CONSTRAINT `AIActionApproval_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AIActionApproval` ADD CONSTRAINT `AIActionApproval_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AIActionApproval` ADD CONSTRAINT `AIActionApproval_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AIActionApproval` ADD CONSTRAINT `AIActionApproval_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
