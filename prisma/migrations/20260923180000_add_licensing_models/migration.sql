-- AlterTable: Role enum gains SUPER_ADMIN (platform-level licensing/subscription admin, Phase 9)
ALTER TABLE `User` MODIFY COLUMN `role` ENUM('SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT') NOT NULL DEFAULT 'RECEPTIONIST';

-- AlterTable: platform-level users (SUPER_ADMIN) belong to no hospital
ALTER TABLE `User` MODIFY COLUMN `hospitalId` VARCHAR(191) NULL;

-- AlterTable: Phase 9 status lifecycle (TRIAL/GRACE_PERIOD/SUSPENDED added; legacy PAST_DUE/TRIALING kept) and new default
ALTER TABLE `Subscription` MODIFY COLUMN `status` ENUM('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'TRIALING', 'TRIAL', 'GRACE_PERIOD', 'SUSPENDED') NOT NULL DEFAULT 'TRIAL';

-- AlterTable: Phase 9 licensing management columns
ALTER TABLE `Subscription` ADD COLUMN `gracePeriodDays` INT NOT NULL DEFAULT 3,
    ADD COLUMN `autoRenew` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `managedBy` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Subscription_status_idx` ON `Subscription`(`status`);
CREATE INDEX `Subscription_currentPeriodEnd_idx` ON `Subscription`(`currentPeriodEnd`);

-- CreateTable
CREATE TABLE `LicenseAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `previousStatus` ENUM('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'TRIALING', 'TRIAL', 'GRACE_PERIOD', 'SUSPENDED') NULL,
    `newStatus` ENUM('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'TRIALING', 'TRIAL', 'GRACE_PERIOD', 'SUSPENDED') NOT NULL,
    `performedBy` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LicenseAuditLog_subscriptionId_idx` ON `LicenseAuditLog`(`subscriptionId`);
CREATE INDEX `LicenseAuditLog_createdAt_idx` ON `LicenseAuditLog`(`createdAt`);

-- AddForeignKey
ALTER TABLE `LicenseAuditLog` ADD CONSTRAINT `LicenseAuditLog_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
