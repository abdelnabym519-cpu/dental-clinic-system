-- Phase 9 — Bounded agentic workflow runs (additive).
--
-- ONE new table (AiWorkflowRun). No existing table, column, index or row is
-- altered or dropped. No native ENUM types — status is a documented String
-- column (same convention as Phase 4 knowledge, Phase 6 multimodal and
-- Phase 8 memory migrations); the TS layer (lib/ai/workflows) is the typed
-- source of truth and validates every transition.
--
--   AiWorkflowRun — durable observation of ONE bounded workflow run:
--   validated state-machine status, bounded step log (JSON), retry attempts,
--   approval hand-off and expiry. hospitalId is the tenant root — every
--   read is tenant-scoped at the query level. patientId/caseId/actorId/
--   approvalId are plain indexed strings (no FKs), matching the additive
--   convention: workflow runs are observability records, not clinical
--   records, and the clinical writes they may PREFER always go through the
--   existing Phase-1 action/approval pipeline (which owns the FK-bound
--   execution ledger).
--
-- Rollback (if ever needed):
--   DROP TABLE `AiWorkflowRun`;

CREATE TABLE `AiWorkflowRun` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `workflowId` VARCHAR(191) NOT NULL,
    `version` INT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `patientId` VARCHAR(191) NULL,
    `caseId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(191) NOT NULL,
    `currentStep` VARCHAR(191) NULL,
    `stepLog` JSON NOT NULL,
    `approvalId` VARCHAR(191) NULL,
    `context` JSON NOT NULL,
    `result` JSON NULL,
    `attempts` INT NOT NULL DEFAULT 1,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    CONSTRAINT `AiWorkflowRun_pkey` PRIMARY KEY (`id`)
);

CREATE INDEX `AiWorkflowRun_hospitalId_status_idx` ON `AiWorkflowRun`(`hospitalId`, `status`);
CREATE INDEX `AiWorkflowRun_hospitalId_patientId_idx` ON `AiWorkflowRun`(`hospitalId`, `patientId`);
CREATE INDEX `AiWorkflowRun_hospitalId_workflowId_status_idx` ON `AiWorkflowRun`(`hospitalId`, `workflowId`, `status`);
