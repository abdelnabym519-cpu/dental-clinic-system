-- Agenda Phase 2b + Messaging platform (additive only)
-- New models: DoctorBreak, BlockedSlot, MessageQueue (+enums)
-- Appointment: optional contactPhone override (messaging)

-- ── DoctorBreak ──────────────────────────────────────────────────────────
CREATE TABLE `DoctorBreak` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DoctorBreak.id_key`(`id`),
    INDEX `DoctorBreak.hospitalId_idx`(`hospitalId`),
    INDEX `DoctorBreak.staffId_dayOfWeek_idx`(`staffId`, `dayOfWeek`),
    CONSTRAINT `DoctorBreak_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `DoctorBreak_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `Staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── BlockedSlot ──────────────────────────────────────────────────────────
CREATE TABLE `BlockedSlot` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NULL,
    `roomId` VARCHAR(191) NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BlockedSlot.id_key`(`id`),
    INDEX `BlockedSlot.hospitalId_startAt_idx`(`hospitalId`, `startAt`),
    INDEX `BlockedSlot.staffId_idx`(`staffId`),
    INDEX `BlockedSlot.roomId_idx`(`roomId`),
    CONSTRAINT `BlockedSlot_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `BlockedSlot_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `Staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `BlockedSlot_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── MessageQueue ─────────────────────────────────────────────────────────
CREATE TABLE `MessageQueue` (
    `id` VARCHAR(191) NOT NULL,
    `hospitalId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NULL,
    `patientId` VARCHAR(191) NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `channel` ENUM('WHATSAPP', 'SMS') NOT NULL,
    `provider` VARCHAR(191) NULL,
    `messageType` ENUM('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H', 'DOCTOR_NEW_APPOINTMENT', 'DOCTOR_CANCELLATION', 'DOCTOR_RESCHEDULE', 'PRESCRIPTION', 'INVOICE', 'RADIOLOGY', 'REVIEW_REQUEST', 'TEST') NOT NULL,
    `payload` JSON NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MessageQueue.id_key`(`id`),
    INDEX `MessageQueue.hospitalId_idx`(`hospitalId`),
    INDEX `MessageQueue.status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `MessageQueue.appointmentId_idx`(`appointmentId`),
    INDEX `MessageQueue.patientId_idx`(`patientId`),
    CONSTRAINT `MessageQueue_hospitalId_fkey` FOREIGN KEY (`hospitalId`) REFERENCES `Hospital`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `MessageQueue_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `MessageQueue_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Appointment.contactPhone (manual messaging number override) ─────────
ALTER TABLE `Appointment` ADD COLUMN `contactPhone` VARCHAR(191) NULL;
