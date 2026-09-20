-- Agenda Phase 2: rooms, appointment room assignment, recurrence grouping,
-- reminder tenant scope. Fully additive / backwards compatible.

-- CreateTable
CREATE TABLE `Room` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Room_hospitalId_name_key`(`hospitalId`, `name`),
    INDEX `Room_hospitalId_idx`(`hospitalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (Appointment: room assignment + recurrence series grouping)
ALTER TABLE `Appointment` ADD COLUMN `roomId` VARCHAR(191) NULL,
  ADD COLUMN `recurrenceGroupId` VARCHAR(191) NULL;

-- CreateTable key/columns done; add indexes and FK for Appointment
ALTER TABLE `Appointment` ADD INDEX `Appointment_roomId_idx`(`roomId`);
ALTER TABLE `Appointment` ADD INDEX `Appointment_recurrenceGroupId_idx`(`recurrenceGroupId`);
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (AppointmentReminder: tenant scope)
ALTER TABLE `AppointmentReminder` ADD COLUMN `hospitalId` VARCHAR(191) NULL;
ALTER TABLE `AppointmentReminder` ADD INDEX `AppointmentReminder_hospitalId_idx`(`hospitalId`);
ALTER TABLE `AppointmentReminder` ADD CONSTRAINT `AppointmentReminder_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
